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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL3R5cC1pbmRleC5qcyIsICJzcmMvc3VidHlwcy5qcyIsICJzcmMvdHlwLXV0aWxzLmpzIiwgInNyYy90eXAtY29sb3JzLmpzIiwgInNyYy9jb25maXJtLW1vZGFsLmpzIiwgInNyYy9mcm9udG1hdHRlci1zb3J0LmpzIiwgInNyYy9mcm9udG1hdHRlci1vcmRlci1lZGl0b3IuanMiLCAic3JjL3NldHRpbmdzLmpzIiwgInNyYy9iYXNlLWRpYWxvZ3MuanMiLCAic3JjL2Jhc2VzLmpzIiwgInNyYy9jb21tYW5kcy5qcyIsICJzcmMvdW5kby5qcyIsICJzcmMvc2hvcnRjdXRzLmpzIiwgInNyYy9zaG9ydGN1dC1waWNrZXIuanMiLCAic3JjL3R5cC1mcm9udG1hdHRlci1lZGl0b3IuanMiLCAic3JjL2Zyb250bWF0dGVyLWJsb2Nrcy5qcyIsICJzcmMvdHlwLXNldHRpbmdzLmpzIiwgInNyYy90eXAtcGFuZS5qcyIsICJzcmMvZmlsZS1leHBsb3Jlci1jb2xvcnMuanMiLCAic3JjL2dyYXBoLWNvbG9ycy5qcyIsICJzcmMvc2VhcmNoLWNvbG9ycy5qcyIsICJzcmMvcmVjZW50LWZpbGVzLWNvbG9ycy5qcyIsICJzcmMvYmFja2xpbmstY29sb3JzLmpzIiwgInNyYy9ib29rbWFyay1jb2xvcnMuanMiLCAic3JjL2FjdGl2ZS10aXRsZS1jb2xvcnMuanMiLCAic3JjL2xpbmstY29sb3JzLmpzIiwgInNyYy9mcm9udG1hdHRlci1kZWZhdWx0LWhpZ2hsaWdodC5qcyIsICJzcmMvcHJvcGVydHktcmVuYW1lLXN5bmMuanMiLCAic3JjL3R5cC1waWNrZXIuanMiLCAic3JjL3Nob3J0Y3V0LXNjcmlwdHMuanMiLCAic3JjL21haW4uanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IHsgRXZlbnRzLCBURmlsZSwgZGVib3VuY2UgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcblxuY29uc3QgVFlQX1BST1BFUlRZID0gXCJUWVBcIjtcbmNvbnN0IFNVQlRZUF9QUk9QRVJUWSA9IFwiU1VCVFlQXCI7XG5jb25zdCBFTVBUWV9FTlRSWSA9IE9iamVjdC5mcmVlemUoeyB0eXBLZXk6IG51bGwsIHJhd1R5cDogbnVsbCwgc3VidHlwS2V5OiBudWxsLCByYXdTdWJ0eXA6IG51bGwgfSk7XG5cbi8vIENvbGxlY3RzIGNoYW5nZXMgdG8gbWFueSBmaWxlcyAocmVuYW1pbmcgYSBUWVAgaW4gbWFueSBub3Rlcywgc3luYykgaW50byBvbmVcbi8vIFwiY2hhbmdlXCIgZXZlbnQuIE5vIHJlc2V0VGltZXIsIHNvIGEgY29uc3RhbnQgc3RyZWFtIHN0aWxsIGdldHMgdGhyb3VnaFxuLy8gcmVndWxhcmx5LlxuY29uc3QgRkxVU0hfREVMQVlfTVMgPSAxMDA7XG5cbmZ1bmN0aW9uIHJhd0l0ZW0odmFsdWUpIHtcbiAgaWYgKHZhbHVlID09IG51bGwpIHJldHVybiBcIlwiO1xuICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiID8gSlNPTi5zdHJpbmdpZnkodmFsdWUpIDogU3RyaW5nKHZhbHVlKTtcbn1cblxuLy8gSG93IHRoZSB3aG9sZSBwbHVnaW4gcmVhZHMgYSBUWVAgdmFsdWU6IGRlbGliZXJhdGVseSBOT1Qgbm9ybWFsaXplZCAtIHRoZVxuLy8gcmF3IGZvcm0gaXMgdGhlIGtleS4gQSBUWVAgaXMgZXhhY3RseSBvbmUgY2xlYW4gdmFsdWU7IGFueXRoaW5nIGVsc2UgKHBhZGRlZCxcbi8vIGxvd2VyY2FzZSwgYSBsaXN0IC0gZXZlbiB3aXRoIG9uZSBpdGVtKSBiZWNvbWVzIGl0cyBvd24ga2V5IHRoYXQgbWF0Y2hlcyBub1xuLy8gcmVnaXN0ZXJlZCBUWVA6IG5vIGNvbG9yLCBub3QgY291bnRlZCBmb3IgdGhlIFwicmVhbFwiIFRZUCwgYW5kIGxpc3RlZCBpbiB0aGVcbi8vIFRZUC1QYW5lIGFzIGFuIHVucmVnaXN0ZXJlZCBlbnRyeSB0aGF0IGEgY2xpY2sgY2xlYW5zIHVwIChzZWUgcmVnaXN0ZXJUeXAgaW5cbi8vIHR5cC1wYW5lLmpzKS4gTGlzdHMgc2hvdyBhcyBcIltBLCBCXVwiIGFuZCBuZXZlciBjb2luY2lkZSB3aXRoIGEgdmFsdWUgXCJBLCBCXCIuXG4vLyBudWxsID0gbm8gVFlQIChtaXNzaW5nLCBlbXB0eSwgYmxhbmssIGVtcHR5IGxpc3QpLlxuZnVuY3Rpb24gdHlwS2V5T2YodmFsdWUpIHtcbiAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgY29uc3QgaXRlbXMgPSB2YWx1ZS5tYXAocmF3SXRlbSk7XG4gICAgaWYgKGl0ZW1zLmV2ZXJ5KChpdGVtKSA9PiBpdGVtLnRyaW0oKSA9PT0gXCJcIikpIHJldHVybiBudWxsO1xuICAgIHJldHVybiBgWyR7aXRlbXMuam9pbihcIiwgXCIpfV1gO1xuICB9XG4gIGNvbnN0IHRleHQgPSByYXdJdGVtKHZhbHVlKTtcbiAgcmV0dXJuIHRleHQudHJpbSgpID09PSBcIlwiID8gbnVsbCA6IHRleHQ7XG59XG5cbi8vIE9ic2lkaWFuIHRyZWF0cyBwcm9wZXJ0eSBuYW1lcyBjYXNlLWluc2Vuc2l0aXZlbHkgKFwiU3VidHlwXCIgYW5kIFwiU1VCVFlQXCJcbi8vIGFyZSBvbmUgcHJvcGVydHkgaW4gXCJBbGwgcHJvcGVydGllc1wiKSwgc28gVFlQIGFuZCBTVUJUWVAgYXJlIHJlYWQgdGhlIHNhbWVcbi8vIHdheS4gVGhlIGV4YWN0IHNwZWxsaW5nIHdpbnMgaWYgYSBub3RlICh3cm9uZ2x5KSBoYXMgc2V2ZXJhbC5cbmZ1bmN0aW9uIHByb3BlcnR5S2V5T2YoZnJvbnRtYXR0ZXIsIG5hbWUpIHtcbiAgaWYgKCFmcm9udG1hdHRlcikgcmV0dXJuIHVuZGVmaW5lZDtcbiAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChmcm9udG1hdHRlciwgbmFtZSkpIHJldHVybiBuYW1lO1xuICBjb25zdCBsb3dlciA9IG5hbWUudG9Mb3dlckNhc2UoKTtcbiAgcmV0dXJuIE9iamVjdC5rZXlzKGZyb250bWF0dGVyKS5maW5kKChrZXkpID0+IGtleS50b0xvd2VyQ2FzZSgpID09PSBsb3dlcik7XG59XG5cbmZ1bmN0aW9uIHByb3BlcnR5VmFsdWUoZnJvbnRtYXR0ZXIsIG5hbWUpIHtcbiAgY29uc3Qga2V5ID0gcHJvcGVydHlLZXlPZihmcm9udG1hdHRlciwgbmFtZSk7XG4gIHJldHVybiBrZXkgPT09IHVuZGVmaW5lZCA/IHVuZGVmaW5lZCA6IGZyb250bWF0dGVyW2tleV07XG59XG5cbi8vIFdyaXRlcyB2YWx1ZSB1bmRlciB0aGUgY2Fub25pY2FsIHNwZWxsaW5nIGBuYW1lYCAoZS5nLiBcIlNVQlRZUFwiKSBpbnRvIHRoZVxuLy8gcHJvY2Vzc0Zyb250TWF0dGVyIG9iamVjdC4gQSBkaWZmZXJlbnRseSBzcGVsbGVkIHZhcmlhbnQgKFwiU3VidHlwXCIpIGlzXG4vLyByZW5hbWVkIGluIHBsYWNlIC0gaW5zZXJ0aW9uIG9yZGVyIGlzIFlBTUwgb3JkZXIsIHNvIGFsbCBrZXlzIGFyZSByZS1hZGRlZFxuLy8gaW4gdGhlaXIgb3JkZXIgaWYgbmVlZGVkIChhcyBpbiBmcm9udG1hdHRlci1zb3J0LmpzKS5cbmZ1bmN0aW9uIHNldENhbm9uaWNhbFByb3BlcnR5KGZyb250bWF0dGVyLCBuYW1lLCB2YWx1ZSkge1xuICBjb25zdCBsb3dlciA9IG5hbWUudG9Mb3dlckNhc2UoKTtcbiAgY29uc3Qga2V5cyA9IE9iamVjdC5rZXlzKGZyb250bWF0dGVyKTtcbiAgaWYgKCFrZXlzLnNvbWUoKGtleSkgPT4ga2V5ICE9PSBuYW1lICYmIGtleS50b0xvd2VyQ2FzZSgpID09PSBsb3dlcikpIHtcbiAgICBmcm9udG1hdHRlcltuYW1lXSA9IHZhbHVlO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBzbmFwc2hvdCA9IHsgLi4uZnJvbnRtYXR0ZXIgfTtcbiAgZm9yIChjb25zdCBrZXkgb2Yga2V5cykgZGVsZXRlIGZyb250bWF0dGVyW2tleV07XG4gIGZvciAoY29uc3Qga2V5IG9mIGtleXMpIHtcbiAgICBpZiAoa2V5LnRvTG93ZXJDYXNlKCkgIT09IGxvd2VyKSBmcm9udG1hdHRlcltrZXldID0gc25hcHNob3Rba2V5XTtcbiAgICBlbHNlIGlmICghKG5hbWUgaW4gZnJvbnRtYXR0ZXIpKSBmcm9udG1hdHRlcltuYW1lXSA9IHZhbHVlO1xuICB9XG59XG5cbi8vIFJlbW92ZXMgYG5hbWVgIGluIGFueSBzcGVsbGluZyBmcm9tIHRoZSBwcm9jZXNzRnJvbnRNYXR0ZXIgb2JqZWN0LlxuZnVuY3Rpb24gZGVsZXRlUHJvcGVydHkoZnJvbnRtYXR0ZXIsIG5hbWUpIHtcbiAgY29uc3QgbG93ZXIgPSBuYW1lLnRvTG93ZXJDYXNlKCk7XG4gIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKGZyb250bWF0dGVyKSkge1xuICAgIGlmIChrZXkudG9Mb3dlckNhc2UoKSA9PT0gbG93ZXIpIGRlbGV0ZSBmcm9udG1hdHRlcltrZXldO1xuICB9XG59XG5cbi8vIFNVQlRZUCBpcyByZWFkIHRoZSBzYW1lIHdheSAodHlwS2V5T2YpOiBhdCBtb3N0IG9uZSBjbGVhbiB2YWx1ZSBwZXIgbm90ZSxcbi8vIGFueXRoaW5nIGVsc2UgaXMgaXRzIG93biB1bnJlZ2lzdGVyZWQga2V5LlxuZnVuY3Rpb24gc2FtZUVudHJ5KGEsIGIpIHtcbiAgcmV0dXJuICEhYSAmJiAhIWIgJiYgYS50eXBLZXkgPT09IGIudHlwS2V5ICYmIGEuc3VidHlwS2V5ID09PSBiLnN1YnR5cEtleTtcbn1cblxuLy8gQ2VudHJhbCBUWVAvU1VCVFlQIGluZGV4IG92ZXIgYWxsIG1hcmtkb3duIGZpbGVzIChwYXRoIC0+IHZhbHVlcykuXG4vL1xuLy8gbWV0YWRhdGFDYWNoZSBcImNoYW5nZWRcIi9cInJlc29sdmVkXCIgZmlyZSBvbiBFVkVSWSBlZGl0IHRvIGFueSBub3RlIChhYm91dFxuLy8gZXZlcnkgdHdvIHNlY29uZHMgd2hpbGUgdHlwaW5nKS4gVGhlIGluZGV4IGNvbXBhcmVzIHBlciBmaWxlIHdoZXRoZXIgVFlQIG9yXG4vLyBTVUJUWVAgcmVhbGx5IGNoYW5nZWQgKG9yIGEgbm90ZSBhcHBlYXJlZC9kaXNhcHBlYXJlZCkgYW5kIG9ubHkgdGhlbiBmaXJlc1xuLy8gaXRzIG93biBcImNoYW5nZVwiIGV2ZW50IChhcmd1bWVudDogc2V0IG9mIGFmZmVjdGVkIHBhdGhzKS4gQWxsIGNvbG9yaW5nIGhhbmdzXG4vLyBvbiB0aGlzIGV2ZW50LCBzbyBub3JtYWwgdHlwaW5nIHRyaWdnZXJzIG5vIHJlY29sb3JpbmcuXG4vL1xuLy8gSXQgYWxzbyBjYWNoZXMgdGhlIHZhdWx0LXdpZGUgY291bnRzIChUWVAtTGlzdCwgU3VidHlwIGxpc3QsIHBpY2tlcnMsXG4vLyBnZXRUeXBzKCkpIGluc3RlYWQgb2YgcmVzY2FubmluZyBldmVyeSBub3RlIG9uIGVhY2ggY2FsbC5cbmNsYXNzIFR5cEluZGV4IGV4dGVuZHMgRXZlbnRzIHtcbiAgY29uc3RydWN0b3IocGx1Z2luKSB7XG4gICAgc3VwZXIoKTtcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgICB0aGlzLmFwcCA9IHBsdWdpbi5hcHA7XG4gICAgdGhpcy5lbnRyaWVzID0gbmV3IE1hcCgpO1xuICAgIHRoaXMuYnVpbHQgPSBmYWxzZTtcbiAgICB0aGlzLmFnZ3JlZ2F0ZXMgPSBudWxsO1xuICAgIHRoaXMucGVuZGluZ1BhdGhzID0gbmV3IFNldCgpO1xuICAgIHRoaXMuZmx1c2ggPSBkZWJvdW5jZSgoKSA9PiB7XG4gICAgICBjb25zdCBwYXRocyA9IHRoaXMucGVuZGluZ1BhdGhzO1xuICAgICAgdGhpcy5wZW5kaW5nUGF0aHMgPSBuZXcgU2V0KCk7XG4gICAgICB0aGlzLnRyaWdnZXIoXCJjaGFuZ2VcIiwgcGF0aHMpO1xuICAgIH0sIEZMVVNIX0RFTEFZX01TKTtcbiAgfVxuXG4gIHJlZ2lzdGVyKCkge1xuICAgIGNvbnN0IHsgcGx1Z2luLCBhcHAgfSA9IHRoaXM7XG4gICAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoYXBwLm1ldGFkYXRhQ2FjaGUub24oXCJjaGFuZ2VkXCIsIChmaWxlKSA9PiB0aGlzLnVwZGF0ZShmaWxlKSkpO1xuICAgIHBsdWdpbi5yZWdpc3RlckV2ZW50KGFwcC5tZXRhZGF0YUNhY2hlLm9uKFwiZGVsZXRlZFwiLCAoZmlsZSkgPT4gdGhpcy5yZW1vdmUoZmlsZS5wYXRoKSkpO1xuICAgIHBsdWdpbi5yZWdpc3RlckV2ZW50KGFwcC52YXVsdC5vbihcInJlbmFtZVwiLCAoZmlsZSwgb2xkUGF0aCkgPT4gdGhpcy5yZW5hbWUoZmlsZSwgb2xkUGF0aCkpKTtcbiAgICAvLyBcIkV4Y2x1ZGVkIGZpbGVzXCIgY2hhbmdlZDogdGhlIGVudHJpZXMgc3RheSB2YWxpZCwgb25seSB0aGUgZmlsdGVyZWRcbiAgICAvLyBjb3VudHMgZG9uJ3QuXG4gICAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoYXBwLnZhdWx0Lm9uKFwiY29uZmlnLWNoYW5nZWRcIiwgKCkgPT4gKHRoaXMuYWdncmVnYXRlcyA9IG51bGwpKSk7XG5cbiAgICAvLyBBdCBzdGFydHVwIHRoZSBmaXJzdCAobGF6eSkgYWNjZXNzIGNhbiBjb21lIGJlZm9yZSB0aGUgbWV0YWRhdGEgY2FjaGUgaXNcbiAgICAvLyBmdWxseSBsb2FkZWQuIFJlYnVpbGQgb25jZSBhZnRlciBpdHMgZmlyc3QgY29tcGxldGUgcmVzb2x2ZTsgZGlmZmVyZW5jZXNcbiAgICAvLyBnbyBvdXQgdGhyb3VnaCB0aGUgXCJjaGFuZ2VcIiBldmVudCBsaWtlIGFueSBvdGhlciBjaGFuZ2UuXG4gICAgY29uc3QgcmVzb2x2ZWRSZWYgPSBhcHAubWV0YWRhdGFDYWNoZS5vbihcInJlc29sdmVkXCIsICgpID0+IHtcbiAgICAgIGFwcC5tZXRhZGF0YUNhY2hlLm9mZnJlZihyZXNvbHZlZFJlZik7XG4gICAgICB0aGlzLnJlYnVpbGQoKTtcbiAgICB9KTtcbiAgICBwbHVnaW4ucmVnaXN0ZXJFdmVudChyZXNvbHZlZFJlZik7XG5cbiAgICBwbHVnaW4ucmVnaXN0ZXIoKCkgPT4gdGhpcy5mbHVzaC5jYW5jZWwoKSk7XG4gIH1cblxuICByZWFkKGZpbGUpIHtcbiAgICBjb25zdCBmcm9udG1hdHRlciA9IHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0RmlsZUNhY2hlKGZpbGUpPy5mcm9udG1hdHRlcjtcbiAgICBjb25zdCByYXdUeXAgPSBwcm9wZXJ0eVZhbHVlKGZyb250bWF0dGVyLCBUWVBfUFJPUEVSVFkpID8/IG51bGw7XG4gICAgY29uc3QgcmF3U3VidHlwID0gcHJvcGVydHlWYWx1ZShmcm9udG1hdHRlciwgU1VCVFlQX1BST1BFUlRZKSA/PyBudWxsO1xuICAgIHJldHVybiB7IHR5cEtleTogdHlwS2V5T2YocmF3VHlwKSwgcmF3VHlwLCBzdWJ0eXBLZXk6IHR5cEtleU9mKHJhd1N1YnR5cCksIHJhd1N1YnR5cCB9O1xuICB9XG5cbiAgZW5zdXJlQnVpbHQoKSB7XG4gICAgaWYgKCF0aGlzLmJ1aWx0KSB0aGlzLnJlYnVpbGQoKTtcbiAgfVxuXG4gIHJlYnVpbGQoKSB7XG4gICAgY29uc3QgcHJldmlvdXMgPSB0aGlzLmVudHJpZXM7XG4gICAgY29uc3Qgd2FzQnVpbHQgPSB0aGlzLmJ1aWx0O1xuICAgIHRoaXMuZW50cmllcyA9IG5ldyBNYXAoKTtcbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgdGhpcy5hcHAudmF1bHQuZ2V0TWFya2Rvd25GaWxlcygpKSB0aGlzLmVudHJpZXMuc2V0KGZpbGUucGF0aCwgdGhpcy5yZWFkKGZpbGUpKTtcbiAgICB0aGlzLmJ1aWx0ID0gdHJ1ZTtcbiAgICB0aGlzLmFnZ3JlZ2F0ZXMgPSBudWxsO1xuICAgIGlmICghd2FzQnVpbHQpIHJldHVybjtcblxuICAgIGZvciAoY29uc3QgW3BhdGgsIGVudHJ5XSBvZiB0aGlzLmVudHJpZXMpIHtcbiAgICAgIGlmICghc2FtZUVudHJ5KHByZXZpb3VzLmdldChwYXRoKSwgZW50cnkpKSB0aGlzLnBlbmRpbmdQYXRocy5hZGQocGF0aCk7XG4gICAgfVxuICAgIGZvciAoY29uc3QgcGF0aCBvZiBwcmV2aW91cy5rZXlzKCkpIHtcbiAgICAgIGlmICghdGhpcy5lbnRyaWVzLmhhcyhwYXRoKSkgdGhpcy5wZW5kaW5nUGF0aHMuYWRkKHBhdGgpO1xuICAgIH1cbiAgICBpZiAodGhpcy5wZW5kaW5nUGF0aHMuc2l6ZSA+IDApIHRoaXMuZmx1c2goKTtcbiAgfVxuXG4gIG1hcmtDaGFuZ2VkKHBhdGgpIHtcbiAgICB0aGlzLmFnZ3JlZ2F0ZXMgPSBudWxsO1xuICAgIHRoaXMucGVuZGluZ1BhdGhzLmFkZChwYXRoKTtcbiAgICB0aGlzLmZsdXNoKCk7XG4gIH1cblxuICB1cGRhdGUoZmlsZSkge1xuICAgIC8vIEJlZm9yZSB0aGUgZmlyc3QgYWNjZXNzIHRoZXJlIGlzIG5vdGhpbmcgc3RhbGU7IHRoZSBsYXp5IGJ1aWxkIHJlYWRzXG4gICAgLy8gZnJlc2ggZnJvbSB0aGUgY2FjaGUgYW55d2F5LlxuICAgIGlmICghdGhpcy5idWlsdCB8fCAhKGZpbGUgaW5zdGFuY2VvZiBURmlsZSkgfHwgZmlsZS5leHRlbnNpb24gIT09IFwibWRcIikgcmV0dXJuO1xuICAgIGNvbnN0IG5leHQgPSB0aGlzLnJlYWQoZmlsZSk7XG4gICAgaWYgKHNhbWVFbnRyeSh0aGlzLmVudHJpZXMuZ2V0KGZpbGUucGF0aCksIG5leHQpKSByZXR1cm47XG4gICAgdGhpcy5lbnRyaWVzLnNldChmaWxlLnBhdGgsIG5leHQpO1xuICAgIHRoaXMubWFya0NoYW5nZWQoZmlsZS5wYXRoKTtcbiAgfVxuXG4gIHJlbW92ZShwYXRoKSB7XG4gICAgaWYgKCF0aGlzLmJ1aWx0IHx8ICF0aGlzLmVudHJpZXMuZGVsZXRlKHBhdGgpKSByZXR1cm47XG4gICAgdGhpcy5tYXJrQ2hhbmdlZChwYXRoKTtcbiAgfVxuXG4gIHJlbmFtZShmaWxlLCBvbGRQYXRoKSB7XG4gICAgaWYgKCF0aGlzLmJ1aWx0KSByZXR1cm47XG4gICAgY29uc3QgZW50cnkgPSB0aGlzLmVudHJpZXMuZ2V0KG9sZFBhdGgpO1xuICAgIGlmIChlbnRyeSkge1xuICAgICAgdGhpcy5lbnRyaWVzLmRlbGV0ZShvbGRQYXRoKTtcbiAgICAgIHRoaXMubWFya0NoYW5nZWQob2xkUGF0aCk7XG4gICAgfVxuICAgIGlmIChmaWxlIGluc3RhbmNlb2YgVEZpbGUgJiYgZmlsZS5leHRlbnNpb24gPT09IFwibWRcIikge1xuICAgICAgdGhpcy5lbnRyaWVzLnNldChmaWxlLnBhdGgsIGVudHJ5ID8/IHRoaXMucmVhZChmaWxlKSk7XG4gICAgICB0aGlzLm1hcmtDaGFuZ2VkKGZpbGUucGF0aCk7XG4gICAgfVxuICB9XG5cbiAgZW50cnlGb3IoZmlsZSkge1xuICAgIGlmICghZmlsZSkgcmV0dXJuIEVNUFRZX0VOVFJZO1xuICAgIHRoaXMuZW5zdXJlQnVpbHQoKTtcbiAgICByZXR1cm4gdGhpcy5lbnRyaWVzLmdldChmaWxlLnBhdGgpID8/IEVNUFRZX0VOVFJZO1xuICB9XG5cbiAgLy8gVFlQIGtleSAoc2VlIHR5cEtleU9mKSBvciBudWxsOyBmb3IgYSBjbGVhbiB2YWx1ZSBzaW1wbHkgdGhlIFRZUCBuYW1lLlxuICB0eXBPZihmaWxlKSB7XG4gICAgcmV0dXJuIHRoaXMuZW50cnlGb3IoZmlsZSkudHlwS2V5O1xuICB9XG5cbiAgLy8gU1VCVFlQIGtleSAoc2VlIHR5cEtleU9mKSBvciBudWxsLlxuICBzdWJ0eXBPZihmaWxlKSB7XG4gICAgcmV0dXJuIHRoaXMuZW50cnlGb3IoZmlsZSkuc3VidHlwS2V5O1xuICB9XG5cbiAgLy8gQW4gYWN0dWFsIGZyb250bWF0dGVyIHZhbHVlIGZvciBhIGtleSAtIGZvciBkaXNwbGF5LCBzZWFyY2ggYW5kIGNsZWFuaW5nXG4gIC8vIHVwIHVucmVnaXN0ZXJlZCBlbnRyaWVzIChhbGwgbm90ZXMgb2YgYSBrZXkgc2hhcmUgdGhlIHNhbWUgcmF3IGZvcm0pLlxuICByYXdWYWx1ZU9mKHR5cEtleSkge1xuICAgIHJldHVybiB0aGlzLmFnZ3JlZ2F0ZSgpLnJhd0J5S2V5LmdldCh0eXBLZXkpO1xuICB9XG5cbiAgLy8gQ2xlYW4gPSBhIHNpbmdsZSB2YWx1ZSB3aXRob3V0IHBhZGRpbmcuIExvd2VyY2FzZSBjb3VudHMgYXMgY2xlYW4gKGEgdmFsaWRcbiAgLy8gVFlQIG5hbWUsIGp1c3Qgbm90IHJlZ2lzdGVyZWQgeWV0KTsgbGlzdHMgYW5kIHBhZGRpbmcgZG9uJ3QuXG4gIGlzQ2xlYW5LZXkodHlwS2V5KSB7XG4gICAgY29uc3QgcmF3ID0gdGhpcy5yYXdWYWx1ZU9mKHR5cEtleSk7XG4gICAgcmV0dXJuIHJhdyAhPT0gdW5kZWZpbmVkICYmICFBcnJheS5pc0FycmF5KHJhdykgJiYgdHlwS2V5ID09PSB0eXBLZXkudHJpbSgpO1xuICB9XG5cbiAgLy8gRmlsZXMgd2l0aCBleGFjdGx5IHRoaXMgVFlQIGtleSwgaG9ub3JpbmcgdGhlIGV4Y2x1ZGVkLWZpbGVzIHNldHRpbmcuXG4gIGZpbGVzV2l0aFR5cCh0eXBLZXkpIHtcbiAgICByZXR1cm4gdGhpcy5maWxlc01hdGNoaW5nKChlbnRyeSkgPT4gZW50cnkudHlwS2V5ID09PSB0eXBLZXkpO1xuICB9XG5cbiAgLy8gRmlsZXMgd2l0aCBleGFjdGx5IHRoaXMgVFlQIGFuZCBTVUJUWVAga2V5LlxuICBmaWxlc1dpdGhTdWJ0eXAodHlwS2V5LCBzdWJ0eXBLZXkpIHtcbiAgICByZXR1cm4gdGhpcy5maWxlc01hdGNoaW5nKChlbnRyeSkgPT4gZW50cnkudHlwS2V5ID09PSB0eXBLZXkgJiYgZW50cnkuc3VidHlwS2V5ID09PSBzdWJ0eXBLZXkpO1xuICB9XG5cbiAgZmlsZXNNYXRjaGluZyhwcmVkaWNhdGUpIHtcbiAgICB0aGlzLmVuc3VyZUJ1aWx0KCk7XG4gICAgY29uc3QgaW5jbHVkZUlnbm9yZWQgPSAhIXRoaXMucGx1Z2luLnNldHRpbmdzLmluY2x1ZGVJZ25vcmVkRmlsZXM7XG4gICAgY29uc3QgZmlsZXMgPSBbXTtcbiAgICBmb3IgKGNvbnN0IFtwYXRoLCBlbnRyeV0gb2YgdGhpcy5lbnRyaWVzKSB7XG4gICAgICBpZiAoIXByZWRpY2F0ZShlbnRyeSkpIGNvbnRpbnVlO1xuICAgICAgaWYgKCFpbmNsdWRlSWdub3JlZCAmJiB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmlzVXNlcklnbm9yZWQocGF0aCkpIGNvbnRpbnVlO1xuICAgICAgY29uc3QgZmlsZSA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChwYXRoKTtcbiAgICAgIGlmIChmaWxlIGluc3RhbmNlb2YgVEZpbGUpIGZpbGVzLnB1c2goZmlsZSk7XG4gICAgfVxuICAgIHJldHVybiBmaWxlcztcbiAgfVxuXG4gIC8vIEhvbm9ycyBPYnNpZGlhbidzIFwiRXhjbHVkZWQgZmlsZXNcIiAod2hlcmUgSGlkZSBGb2xkZXJzIGFsc28gcHV0cyBoaWRkZW5cbiAgLy8gZm9sZGVycykgdW5sZXNzIFwiSW5jbHVkZSBleGNsdWRlZCBmaWxlc1wiIGlzIG9uLiBBIG5vdGUgd2l0aG91dCBhIFRZUCBoYXNcbiAgLy8gbm8gU1VCVFlQIGNvbnRleHQuXG4gIGFnZ3JlZ2F0ZSgpIHtcbiAgICB0aGlzLmVuc3VyZUJ1aWx0KCk7XG4gICAgY29uc3QgaW5jbHVkZUlnbm9yZWQgPSAhIXRoaXMucGx1Z2luLnNldHRpbmdzLmluY2x1ZGVJZ25vcmVkRmlsZXM7XG4gICAgaWYgKHRoaXMuYWdncmVnYXRlcz8uaW5jbHVkZUlnbm9yZWQgPT09IGluY2x1ZGVJZ25vcmVkKSByZXR1cm4gdGhpcy5hZ2dyZWdhdGVzO1xuXG4gICAgY29uc3QgY291bnRzID0gbmV3IE1hcCgpO1xuICAgIGNvbnN0IHJhd0J5S2V5ID0gbmV3IE1hcCgpO1xuICAgIGNvbnN0IHN1YnR5cHNCeVR5cCA9IG5ldyBNYXAoKTtcbiAgICBsZXQgbm9UeXAgPSAwO1xuICAgIGZvciAoY29uc3QgW3BhdGgsIHsgdHlwS2V5LCByYXdUeXAsIHN1YnR5cEtleSwgcmF3U3VidHlwIH1dIG9mIHRoaXMuZW50cmllcykge1xuICAgICAgaWYgKCFpbmNsdWRlSWdub3JlZCAmJiB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmlzVXNlcklnbm9yZWQocGF0aCkpIGNvbnRpbnVlO1xuICAgICAgaWYgKHR5cEtleSA9PT0gbnVsbCkge1xuICAgICAgICBub1R5cCsrO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvdW50cy5zZXQodHlwS2V5LCAoY291bnRzLmdldCh0eXBLZXkpID8/IDApICsgMSk7XG4gICAgICBpZiAoIXJhd0J5S2V5Lmhhcyh0eXBLZXkpKSByYXdCeUtleS5zZXQodHlwS2V5LCByYXdUeXApO1xuICAgICAgbGV0IGJ1Y2tldCA9IHN1YnR5cHNCeVR5cC5nZXQodHlwS2V5KTtcbiAgICAgIGlmICghYnVja2V0KSB7XG4gICAgICAgIGJ1Y2tldCA9IHsgY291bnRzOiBuZXcgTWFwKCksIG5vU3VidHlwOiAwLCByYXdCeUtleTogbmV3IE1hcCgpIH07XG4gICAgICAgIHN1YnR5cHNCeVR5cC5zZXQodHlwS2V5LCBidWNrZXQpO1xuICAgICAgfVxuICAgICAgaWYgKHN1YnR5cEtleSA9PT0gbnVsbCkge1xuICAgICAgICBidWNrZXQubm9TdWJ0eXArKztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGJ1Y2tldC5jb3VudHMuc2V0KHN1YnR5cEtleSwgKGJ1Y2tldC5jb3VudHMuZ2V0KHN1YnR5cEtleSkgPz8gMCkgKyAxKTtcbiAgICAgICAgaWYgKCFidWNrZXQucmF3QnlLZXkuaGFzKHN1YnR5cEtleSkpIGJ1Y2tldC5yYXdCeUtleS5zZXQoc3VidHlwS2V5LCByYXdTdWJ0eXApO1xuICAgICAgfVxuICAgIH1cbiAgICB0aGlzLmFnZ3JlZ2F0ZXMgPSB7IGluY2x1ZGVJZ25vcmVkLCBjb3VudHMsIG5vVHlwLCByYXdCeUtleSwgc3VidHlwc0J5VHlwIH07XG4gICAgcmV0dXJuIHRoaXMuYWdncmVnYXRlcztcbiAgfVxuXG4gIC8vIENhY2hlZCAtIGRvbid0IG1vZGlmeSB0aGUgcmV0dXJuZWQgbWFwcy5cbiAgdHlwQ291bnRzKCkge1xuICAgIGNvbnN0IHsgY291bnRzLCBub1R5cCB9ID0gdGhpcy5hZ2dyZWdhdGUoKTtcbiAgICByZXR1cm4geyBjb3VudHMsIG5vVHlwIH07XG4gIH1cblxuICAvLyBUWVAgLT4geyBjb3VudHM6IE1hcChTVUJUWVAga2V5IC0+IGNvdW50KSwgbm9TdWJ0eXAsIHJhd0J5S2V5IH0uXG4gIC8vIENhY2hlZCAtIGRvbid0IG1vZGlmeS5cbiAgc3VidHlwQ291bnRzKCkge1xuICAgIHJldHVybiB0aGlzLmFnZ3JlZ2F0ZSgpLnN1YnR5cHNCeVR5cDtcbiAgfVxuXG4gIHN1YnR5cEJ1Y2tldCh0eXBLZXkpIHtcbiAgICByZXR1cm4gdGhpcy5zdWJ0eXBDb3VudHMoKS5nZXQodHlwS2V5KSA/PyBFTVBUWV9CVUNLRVQ7XG4gIH1cbn1cblxuY29uc3QgRU1QVFlfQlVDS0VUID0gT2JqZWN0LmZyZWV6ZSh7IGNvdW50czogbmV3IE1hcCgpLCBub1N1YnR5cDogMCwgcmF3QnlLZXk6IG5ldyBNYXAoKSB9KTtcblxubW9kdWxlLmV4cG9ydHMgPSB7IFR5cEluZGV4LCB0eXBLZXlPZiwgcHJvcGVydHlWYWx1ZSwgc2V0Q2Fub25pY2FsUHJvcGVydHksIGRlbGV0ZVByb3BlcnR5LCBUWVBfUFJPUEVSVFksIFNVQlRZUF9QUk9QRVJUWSB9O1xuIiwgImNvbnN0IHsgdHlwS2V5T2YsIHByb3BlcnR5VmFsdWUsIHNldENhbm9uaWNhbFByb3BlcnR5LCBTVUJUWVBfUFJPUEVSVFkgfSA9IHJlcXVpcmUoXCIuL3R5cC1pbmRleFwiKTtcblxuLy8gU3VidHlwIG5hbWVzIGFyZSB0aXRsZSBjYXNlIHBlciB3b3JkICh1bmxpa2UgVFlQIG5hbWVzLCBzZWVcbi8vIG5vcm1hbGl6ZVR5cE5hbWUpOiBcImt1cnogR0VTQ0hJQ0hURVwiIC0+IFwiS3VyeiBHZXNjaGljaHRlXCIuIFRoZSBTVUJUWVBcbi8vIHByb3BlcnR5IGl0c2VsZiBzdGF5cyB1cHBlcmNhc2UuIFwiZGVcIiBsb2NhbGUgYmVjYXVzZSB0aGUgbmFtZXMgYXJlIEdlcm1hbi5cbmZ1bmN0aW9uIG5vcm1hbGl6ZVN1YnR5cE5hbWUocmF3KSB7XG4gIHJldHVybiByYXcudHJpbSgpLnJlcGxhY2UoL1xcUysvZywgKHdvcmQpID0+IHdvcmQuY2hhckF0KDApLnRvTG9jYWxlVXBwZXJDYXNlKFwiZGVcIikgKyB3b3JkLnNsaWNlKDEpLnRvTG9jYWxlTG93ZXJDYXNlKFwiZGVcIikpO1xufVxuXG4vLyBSZWdpc3RlcmVkIFN1YnR5cHMgcGVyIFRZUCAoc2V0dGluZ3MudHlwU3VidHlwcyk6XG4vLyAgIHsgW1RZUF06IHsgW1NVQlRZUF06IHsgZnJvbnRtYXR0ZXI6IHsuLi59LCBmbG9hdGluZ0tleXM6IFsuLi5dLCBzaG9ydGN1dHM6IHsuLi59LCBtYW51YWw/OiBmYWxzZSB9IH0gfVxuLy8gQSBTdWJ0eXAgYmVsb25ncyB0byBleGFjdGx5IG9uZSBUWVAsIHRob3VnaCB0aGUgc2FtZSBuYW1lIG1heSBhbHNvIGV4aXN0XG4vLyB1bmRlciBhbm90aGVyIFRZUC4gS2V5IG9yZGVyIGlzIHRoZSBibG9jayBvcmRlciBpbiB0aGUgVFlQLVBhbmUsIGFsd2F5c1xuLy8gYmVsb3cgdGhlIFRZUC1Gcm9udG1hdHRlci4gZnJvbnRtYXR0ZXIgYWRkcyB0byBvciBvdmVycmlkZXMgdGhlXG4vLyBUWVAtRnJvbnRtYXR0ZXI7IGZsb2F0aW5nS2V5cyBhbmQgc2hvcnRjdXRzIHdvcmsgbGlrZSB0eXBGbG9hdGluZ0tleXMgYW5kXG4vLyB0eXBTaG9ydGN1dHMuIE9sZGVyIGRhdGEgbGFja3Mgc2hvcnRjdXRzLCBzbyByZWFkZXJzIHRyZWF0IGl0IGFzIG9wdGlvbmFsLlxuLy8gbWFudWFsIHdvcmtzIGxpa2UgdHlwTWFudWFsOiBvbmx5IHRoZSBkZXZpYXRpb24gKGZhbHNlKSBpcyBzdG9yZWQuXG4vL1xuLy8gVGhlIHNhbWUga2V5IG1heSBhcHBlYXIgaW4gc2V2ZXJhbCBibG9ja3Mgb2Ygb25lIFRZUCAob25seSB3aXRoaW4gT05FIGJsb2NrXG4vLyBpcyBpdCBuZWNlc3NhcmlseSB1bmlxdWUpOlxuLy8gICAtIGluIHR3byBTdWJ0eXAgYmxvY2tzOiBubyBjb25mbGljdCwgYSBub3RlIGhhcyBhdCBtb3N0IG9uZSBTVUJUWVA7XG4vLyAgIC0gaW4gdGhlIFRZUC1Gcm9udG1hdHRlciBBTkQgYSBTdWJ0eXAgYmxvY2s6IHRoZSBTdWJ0eXAgb3ZlcnJpZGVzIHZhbHVlXG4vLyAgICAgYW5kIGZsb2F0aW5nIGZsYWcsIHRoZSByb3cga2VlcHMgdGhlIFRZUC1Gcm9udG1hdHRlciBwb3NpdGlvbi4gZ2V0VHlwRGVmYXVsdHNcbi8vICAgICAobWFpbi5qcykgYW5kIG9yZGVyZWREZWZhdWx0S2V5cyAoZnJvbnRtYXR0ZXItc29ydC5qcykgbXVzdCB1c2UgdGhlIHNhbWVcbi8vICAgICBydWxlLCBvciBzb3J0aW5nIHdvdWxkIHJlLXNvcnQgYSBmcmVzaGx5IGNyZWF0ZWQgbm90ZSByaWdodCBhd2F5LlxuXG4vLyBcIlN0aWxsIHRvIGJlIGZpbGxlZFwiOiB3aGVuIHR3byBibG9ja3Mgb3IgdHdvIHByb3BlcnRpZXMgbWVyZ2UsIHN1Y2ggYSB2YWx1ZVxuLy8gaXMgZmlsbGVkIGZyb20gdGhlIG90aGVyIGluc3RlYWQgb2Ygb3ZlcndyaXRpbmcgdGhlIGV4aXN0aW5nIGVudHJ5IChzZWVcbi8vIG1lcmdlU3VidHlwcyBoZXJlIGFuZCByZW5hbWVJblN0b3JlIGluIHByb3BlcnR5LXJlbmFtZS1zeW5jLmpzKS5cbmZ1bmN0aW9uIGlzRW1wdHlWYWx1ZSh2YWx1ZSkge1xuICByZXR1cm4gdmFsdWUgPT09IG51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCB8fCB2YWx1ZSA9PT0gXCJcIjtcbn1cblxuZnVuY3Rpb24gZ2V0U3VidHlwTmFtZXMoc2V0dGluZ3MsIHR5cCkge1xuICByZXR1cm4gT2JqZWN0LmtleXMoc2V0dGluZ3MudHlwU3VidHlwcz8uW3R5cF0gPz8ge30pO1xufVxuXG5mdW5jdGlvbiBnZXRTdWJ0eXAoc2V0dGluZ3MsIHR5cCwgc3VidHlwKSB7XG4gIHJldHVybiBzZXR0aW5ncy50eXBTdWJ0eXBzPy5bdHlwXT8uW3N1YnR5cF0gPz8gbnVsbDtcbn1cblxuZnVuY3Rpb24gZW5zdXJlU3VidHlwKHNldHRpbmdzLCB0eXAsIHN1YnR5cCkge1xuICBpZiAoIXNldHRpbmdzLnR5cFN1YnR5cHMpIHNldHRpbmdzLnR5cFN1YnR5cHMgPSB7fTtcbiAgaWYgKCFzZXR0aW5ncy50eXBTdWJ0eXBzW3R5cF0pIHNldHRpbmdzLnR5cFN1YnR5cHNbdHlwXSA9IHt9O1xuICBjb25zdCBieU5hbWUgPSBzZXR0aW5ncy50eXBTdWJ0eXBzW3R5cF07XG4gIGlmICghYnlOYW1lW3N1YnR5cF0pIHtcbiAgICBieU5hbWVbc3VidHlwXSA9IHsgZnJvbnRtYXR0ZXI6IHt9LCBmbG9hdGluZ0tleXM6IFtdLCBzaG9ydGN1dHM6IHt9IH07XG4gICAgLy8gQSBuZXcgU3VidHlwIG9mIGEgVFlQIHRoYXQgaXNuJ3QgbWFudWFsbHkgY3JlYXRhYmxlIGlzbid0IGVpdGhlciAoc2VlXG4gICAgLy8gaXNTdWJ0eXBNYW51YWwpLlxuICAgIGlmIChzZXR0aW5ncy50eXBNYW51YWw/Llt0eXBdID09PSBmYWxzZSkgYnlOYW1lW3N1YnR5cF0ubWFudWFsID0gZmFsc2U7XG4gIH1cbiAgcmV0dXJuIGJ5TmFtZVtzdWJ0eXBdO1xufVxuXG4vKiAtLS0gXCJNYW51YWxseSBjcmVhdGFibGVcIiBwZXIgU3VidHlwIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICogTGlrZSB0eXBNYW51YWwgZm9yIFRZUCBlbnRyaWVzOiBvbmx5IHN3aXRjaGluZyBvZmYgaXMgc3RvcmVkXG4gKiAobWFudWFsOiBmYWxzZSk7IG5vIGVudHJ5IG9yIHRydWUgbWVhbnMgb24uIERlY2lkZXMgd2hldGhlciB0aGUgU3VidHlwXG4gKiBzaG93cyB1cCBpbiBnZXRTdWJ0eXBzKCkgKG1haW4uanMpIGFuZCB0aHVzIGluIHRoZSBTdWJ0eXAtUGlja2VyLlxuICpcbiAqIFRZUCBhbmQgU3VidHlwIGFyZSBsaW5rZWQsIGJlY2F1c2UgdGhlIHBpY2tlciBvbmx5IHJlYWNoZXMgYSBTdWJ0eXAgdGhyb3VnaFxuICogaXRzIFRZUDogc3dpdGNoaW5nIGEgVFlQIG9mZiBzd2l0Y2hlcyBhbGwgaXRzIFN1YnR5cHMgb2ZmLCBzd2l0Y2hpbmcgaXQgb25cbiAqIHN3aXRjaGVzIHRoZW0gYWxsIG9uIChzZXRBbGxTdWJ0eXBzTWFudWFsKSwgYW5kIHN3aXRjaGluZyBhIHNpbmdsZSBTdWJ0eXAgb25cbiAqIGFsc28gc3dpdGNoZXMgaXRzIFRZUCBvbiwgbGVhdmluZyB0aGUgb3RoZXIgU3VidHlwcyBhbG9uZSAoc2VlXG4gKiByZW5kZXJTdWJ0eXBNYW51YWxUb2dnbGUgaW4gdHlwLXBhbmUuanMpLiBTbyBhIFN1YnR5cCBpcyBvbmx5IGV2ZXIgbWFudWFsbHlcbiAqIGNyZWF0YWJsZSBpZiBpdHMgVFlQIGlzLlxuICogLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tICovXG5mdW5jdGlvbiBpc1N1YnR5cE1hbnVhbChzZXR0aW5ncywgdHlwLCBzdWJ0eXApIHtcbiAgcmV0dXJuIGdldFN1YnR5cChzZXR0aW5ncywgdHlwLCBzdWJ0eXApPy5tYW51YWwgIT09IGZhbHNlO1xufVxuXG5mdW5jdGlvbiBzZXRTdWJ0eXBNYW51YWwoc2V0dGluZ3MsIHR5cCwgc3VidHlwLCBvbikge1xuICBjb25zdCBkYXRhID0gZ2V0U3VidHlwKHNldHRpbmdzLCB0eXAsIHN1YnR5cCk7XG4gIGlmICghZGF0YSkgcmV0dXJuO1xuICBpZiAob24pIGRlbGV0ZSBkYXRhLm1hbnVhbDtcbiAgZWxzZSBkYXRhLm1hbnVhbCA9IGZhbHNlO1xufVxuXG5mdW5jdGlvbiBzZXRBbGxTdWJ0eXBzTWFudWFsKHNldHRpbmdzLCB0eXAsIG9uKSB7XG4gIGZvciAoY29uc3Qgc3VidHlwIG9mIGdldFN1YnR5cE5hbWVzKHNldHRpbmdzLCB0eXApKSBzZXRTdWJ0eXBNYW51YWwoc2V0dGluZ3MsIHR5cCwgc3VidHlwLCBvbik7XG59XG5cbi8vIFdoZW4gYSBUWVAgaXMgcmVuYW1lZCwgaXRzIFN1YnR5cHMgbW92ZSB0byB0aGUgbmV3IG5hbWUuXG5mdW5jdGlvbiBtb3ZlVHlwU3VidHlwcyhzZXR0aW5ncywgb2xkVHlwLCBuZXdUeXApIHtcbiAgaWYgKCFzZXR0aW5ncy50eXBTdWJ0eXBzPy5bb2xkVHlwXSkgcmV0dXJuO1xuICBzZXR0aW5ncy50eXBTdWJ0eXBzW25ld1R5cF0gPSBzZXR0aW5ncy50eXBTdWJ0eXBzW29sZFR5cF07XG4gIGRlbGV0ZSBzZXR0aW5ncy50eXBTdWJ0eXBzW29sZFR5cF07XG59XG5cbmZ1bmN0aW9uIGRlbGV0ZVR5cFN1YnR5cHMoc2V0dGluZ3MsIHR5cCkge1xuICBpZiAoc2V0dGluZ3MudHlwU3VidHlwcykgZGVsZXRlIHNldHRpbmdzLnR5cFN1YnR5cHNbdHlwXTtcbn1cblxuLy8gTWVyZ2luZyB0d28gVFlQIGVudHJpZXM6IFN1YnR5cHMgb25seSBpbiBzb3VyY2UgbW92ZSBvdmVyLiBCbG9ja3Mgd2l0aCB0aGVcbi8vIHNhbWUgbmFtZSBhcmUgY29tYmluZWQgLSBmb3IgYSBzaGFyZWQga2V5IHRoZSB0YXJnZXQncyB2YWx1ZSBhbmQgZmxvYXRpbmdcbi8vIGZsYWcgd2luLCBrZXlzIG9ubHkgaW4gc291cmNlIGFyZSBhcHBlbmRlZC4gQSBtb3ZlZCBrZXkgdGhhdCBpcyBhbHNvIGluIHRoZVxuLy8gdGFyZ2V0J3MgVFlQLUZyb250bWF0dGVyIHN0YXlzIGluIGJvdGgsIHdoaWNoIGlzIHRoZSBub3JtYWwgb3ZlcnJpZGUuXG5mdW5jdGlvbiBtZXJnZVR5cFN1YnR5cHMoc2V0dGluZ3MsIHNvdXJjZSwgdGFyZ2V0KSB7XG4gIGNvbnN0IHNvdXJjZVN1YnR5cHMgPSBzZXR0aW5ncy50eXBTdWJ0eXBzPy5bc291cmNlXTtcbiAgaWYgKCFzb3VyY2VTdWJ0eXBzKSByZXR1cm47XG4gIGZvciAoY29uc3QgW25hbWUsIHNvdXJjZURhdGFdIG9mIE9iamVjdC5lbnRyaWVzKHNvdXJjZVN1YnR5cHMpKSB7XG4gICAgY29uc3QgdGFyZ2V0RGF0YSA9IGdldFN1YnR5cChzZXR0aW5ncywgdGFyZ2V0LCBuYW1lKTtcbiAgICBpZiAoIXRhcmdldERhdGEpIHtcbiAgICAgIGVuc3VyZVN1YnR5cChzZXR0aW5ncywgdGFyZ2V0LCBuYW1lKTtcbiAgICAgIHNldHRpbmdzLnR5cFN1YnR5cHNbdGFyZ2V0XVtuYW1lXSA9IHNvdXJjZURhdGE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgdGFyZ2V0TG93ZXIgPSBuZXcgU2V0KE9iamVjdC5rZXlzKHRhcmdldERhdGEuZnJvbnRtYXR0ZXIpLm1hcCgoa2V5KSA9PiBrZXkudG9Mb3dlckNhc2UoKSkpO1xuICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHNvdXJjZURhdGEuZnJvbnRtYXR0ZXIpKSB7XG4gICAgICBpZiAoa2V5ID09PSBcIlwiIHx8IHRhcmdldExvd2VyLmhhcyhrZXkudG9Mb3dlckNhc2UoKSkpIGNvbnRpbnVlO1xuICAgICAgdGFyZ2V0RGF0YS5mcm9udG1hdHRlcltrZXldID0gdmFsdWU7XG4gICAgICBpZiAoc291cmNlRGF0YS5mbG9hdGluZ0tleXMuaW5jbHVkZXMoa2V5KSkgdGFyZ2V0RGF0YS5mbG9hdGluZ0tleXMucHVzaChrZXkpO1xuICAgICAgLy8gVGhlIHNob3J0Y3V0IGJlbG9uZ3MgdG8gdGhlIGtleSBhbmQgbW92ZXMgd2l0aCBpdC5cbiAgICAgIGNvbnN0IHNob3J0Y3V0ID0gc291cmNlRGF0YS5zaG9ydGN1dHM/LltrZXldO1xuICAgICAgaWYgKHNob3J0Y3V0KSAodGFyZ2V0RGF0YS5zaG9ydGN1dHMgPz89IHt9KVtrZXldID0gc2hvcnRjdXQ7XG4gICAgfVxuICB9XG4gIGRlbGV0ZSBzZXR0aW5ncy50eXBTdWJ0eXBzW3NvdXJjZV07XG59XG5cbi8vIFJlbmFtZXMgYSBTdWJ0eXAgd2l0aGluIGl0cyBUWVA7IHRoZSBibG9jayBrZWVwcyBpdHMgcG9zaXRpb24gKGRpc3BsYXlcbi8vIG9yZGVyID0ga2V5IG9yZGVyKS5cbmZ1bmN0aW9uIHJlbmFtZVN1YnR5cChzZXR0aW5ncywgdHlwLCBvbGROYW1lLCBuZXdOYW1lKSB7XG4gIGNvbnN0IGJ5TmFtZSA9IHNldHRpbmdzLnR5cFN1YnR5cHM/Llt0eXBdO1xuICBpZiAoIWJ5TmFtZT8uW29sZE5hbWVdIHx8IG9sZE5hbWUgPT09IG5ld05hbWUpIHJldHVybjtcbiAgc2V0dGluZ3MudHlwU3VidHlwc1t0eXBdID0gT2JqZWN0LmZyb21FbnRyaWVzKFxuICAgIE9iamVjdC5lbnRyaWVzKGJ5TmFtZSkubWFwKChbbmFtZSwgZGF0YV0pID0+IFtuYW1lID09PSBvbGROYW1lID8gbmV3TmFtZSA6IG5hbWUsIGRhdGFdKVxuICApO1xufVxuXG4vLyBPcmRlciBvZiBhbGwgYmxvY2tzIG9mIGEgVFlQLCBudWxsID0gVFlQLUZyb250bWF0dGVyIChhbHdheXMgZmlyc3QpLCB0aGVuXG4vLyB0aGUgU3VidHlwcyBpbiBrZXkgb3JkZXIuIERyaXZlcyB0aGUgVFlQLVBhbmUgYXMgd2VsbCBhcyBmcm9udG1hdHRlclxuLy8gc29ydGluZyAoc2VlIG9yZGVyZWREZWZhdWx0S2V5cykuXG5mdW5jdGlvbiBnZXRTZWN0aW9uT3JkZXIoc2V0dGluZ3MsIHR5cCkge1xuICByZXR1cm4gW251bGwsIC4uLmdldFN1YnR5cE5hbWVzKHNldHRpbmdzLCB0eXApXTtcbn1cblxuLy8gTmV3IGJsb2NrIG9yZGVyIGZyb20gZHJhZyAmIGRyb3AgaW4gdGhlIFRZUC1QYW5lLCBzaGFwZWQgbGlrZVxuLy8gZ2V0U2VjdGlvbk9yZGVyOyB0aGUgbGVhZGluZyBudWxsIGlzIGlnbm9yZWQgKHRoZSBUWVAtRnJvbnRtYXR0ZXIgY2FuJ3Rcbi8vIG1vdmUpLiBTdWJ0eXBzIG5vdCBsaXN0ZWQgc3RheSBhdCB0aGUgZW5kLlxuZnVuY3Rpb24gcmVvcmRlclN1YnR5cHMoc2V0dGluZ3MsIHR5cCwgb3JkZXIpIHtcbiAgY29uc3QgYnlOYW1lID0gc2V0dGluZ3MudHlwU3VidHlwcz8uW3R5cF07XG4gIGlmICghYnlOYW1lKSByZXR1cm47XG4gIGNvbnN0IG5hbWVzID0gb3JkZXIuZmlsdGVyKChuYW1lKSA9PiBuYW1lICE9PSBudWxsICYmIGJ5TmFtZVtuYW1lXSk7XG4gIGNvbnN0IG9yZGVyZWQgPSBbLi4ubmFtZXMsIC4uLk9iamVjdC5rZXlzKGJ5TmFtZSkuZmlsdGVyKChuYW1lKSA9PiAhbmFtZXMuaW5jbHVkZXMobmFtZSkpXTtcbiAgc2V0dGluZ3MudHlwU3VidHlwc1t0eXBdID0gT2JqZWN0LmZyb21FbnRyaWVzKG9yZGVyZWQubWFwKChuYW1lKSA9PiBbbmFtZSwgYnlOYW1lW25hbWVdXSkpO1xufVxuXG5mdW5jdGlvbiBkZWxldGVTdWJ0eXAoc2V0dGluZ3MsIHR5cCwgbmFtZSkge1xuICBjb25zdCBieU5hbWUgPSBzZXR0aW5ncy50eXBTdWJ0eXBzPy5bdHlwXTtcbiAgaWYgKCFieU5hbWUpIHJldHVybjtcbiAgZGVsZXRlIGJ5TmFtZVtuYW1lXTtcbiAgaWYgKE9iamVjdC5rZXlzKGJ5TmFtZSkubGVuZ3RoID09PSAwKSBkZWxldGUgc2V0dGluZ3MudHlwU3VidHlwc1t0eXBdO1xufVxuXG4vLyBNZXJnaW5nIHR3byBTdWJ0eXBzIG9mIG9uZSBUWVA6IHNvdXJjZSdzIHByb3BlcnRpZXMgZ28gdG8gdGhlIGVuZCBvZiB0aGVcbi8vIHRhcmdldCBibG9jaywgc291cmNlIGRpc2FwcGVhcnMuIElmIHRoZSB0YXJnZXQgYWxyZWFkeSBoYXMgYSBrZXksIGl0IGtlZXBzXG4vLyBwb3NpdGlvbiwgdmFsdWUgYW5kIGZsb2F0aW5nIGZsYWc7IG9ubHkgYW4gZW1wdHkgdGFyZ2V0IHZhbHVlIGlzIGZpbGxlZFxuLy8gZnJvbSBzb3VyY2UgKHNhbWUgcGF0dGVybiBhcyByZW5hbWVJblN0b3JlIGluIHByb3BlcnR5LXJlbmFtZS1zeW5jLmpzKS5cbmZ1bmN0aW9uIG1lcmdlU3VidHlwcyhzZXR0aW5ncywgdHlwLCBzb3VyY2UsIHRhcmdldCkge1xuICBjb25zdCBzb3VyY2VEYXRhID0gZ2V0U3VidHlwKHNldHRpbmdzLCB0eXAsIHNvdXJjZSk7XG4gIGNvbnN0IHRhcmdldERhdGEgPSBnZXRTdWJ0eXAoc2V0dGluZ3MsIHR5cCwgdGFyZ2V0KTtcbiAgaWYgKCFzb3VyY2VEYXRhIHx8ICF0YXJnZXREYXRhIHx8IHNvdXJjZSA9PT0gdGFyZ2V0KSByZXR1cm47XG5cbiAgY29uc3QgdGFyZ2V0S2V5cyA9IG5ldyBNYXAoT2JqZWN0LmtleXModGFyZ2V0RGF0YS5mcm9udG1hdHRlcikubWFwKChrZXkpID0+IFtrZXkudG9Mb3dlckNhc2UoKSwga2V5XSkpO1xuICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhzb3VyY2VEYXRhLmZyb250bWF0dGVyKSkge1xuICAgIGlmIChrZXkgPT09IFwiXCIpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGV4aXN0aW5nID0gdGFyZ2V0S2V5cy5nZXQoa2V5LnRvTG93ZXJDYXNlKCkpO1xuICAgIGlmIChleGlzdGluZyA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICB0YXJnZXREYXRhLmZyb250bWF0dGVyW2tleV0gPSB2YWx1ZTtcbiAgICAgIHRhcmdldEtleXMuc2V0KGtleS50b0xvd2VyQ2FzZSgpLCBrZXkpO1xuICAgICAgaWYgKHNvdXJjZURhdGEuZmxvYXRpbmdLZXlzLmluY2x1ZGVzKGtleSkgJiYgIXRhcmdldERhdGEuZmxvYXRpbmdLZXlzLmluY2x1ZGVzKGtleSkpIHRhcmdldERhdGEuZmxvYXRpbmdLZXlzLnB1c2goa2V5KTtcbiAgICAgIC8vIFRoZSBzaG9ydGN1dCBiZWxvbmdzIHRvIHRoZSBrZXkgYW5kIG1vdmVzIHdpdGggaXQuXG4gICAgICBjb25zdCBzaG9ydGN1dCA9IHNvdXJjZURhdGEuc2hvcnRjdXRzPy5ba2V5XTtcbiAgICAgIGlmIChzaG9ydGN1dCkgKHRhcmdldERhdGEuc2hvcnRjdXRzID8/PSB7fSlba2V5XSA9IHNob3J0Y3V0O1xuICAgIH0gZWxzZSBpZiAoaXNFbXB0eVZhbHVlKHRhcmdldERhdGEuZnJvbnRtYXR0ZXJbZXhpc3RpbmddKSkge1xuICAgICAgdGFyZ2V0RGF0YS5mcm9udG1hdHRlcltleGlzdGluZ10gPSB2YWx1ZTtcbiAgICB9XG4gIH1cbiAgZGVsZXRlU3VidHlwKHNldHRpbmdzLCB0eXAsIHNvdXJjZSk7XG59XG5cbi8vIFJld3JpdGVzIHRoZSBTVUJUWVAgb2YgZXZlcnkgbm90ZSB3aXRoIFRZUCBrZXkgYHR5cGAgYW5kIFNVQlRZUCBrZXkgb2xkS2V5XG4vLyB0byB0aGUgc2luZ2xlIHZhbHVlIG5ld1ZhbHVlIC0gbGlrZSByZW5hbWVUeXBJbk5vdGVzKCkgaW4gdHlwLXBhbmUuanMuXG5hc3luYyBmdW5jdGlvbiByZW5hbWVTdWJ0eXBJbk5vdGVzKHBsdWdpbiwgdHlwLCBvbGRLZXksIG5ld1ZhbHVlKSB7XG4gIGxldCBjaGFuZ2VkID0gMDtcbiAgZm9yIChjb25zdCBmaWxlIG9mIHBsdWdpbi50eXBJbmRleC5maWxlc1dpdGhTdWJ0eXAodHlwLCBvbGRLZXkpKSB7XG4gICAgbGV0IG1hdGNoZWQgPSBmYWxzZTtcbiAgICBhd2FpdCBwbHVnaW4uYXBwLmZpbGVNYW5hZ2VyLnByb2Nlc3NGcm9udE1hdHRlcihmaWxlLCAoZnJvbnRtYXR0ZXIpID0+IHtcbiAgICAgIGlmICh0eXBLZXlPZihwcm9wZXJ0eVZhbHVlKGZyb250bWF0dGVyLCBTVUJUWVBfUFJPUEVSVFkpKSAhPT0gb2xkS2V5KSByZXR1cm47XG4gICAgICBzZXRDYW5vbmljYWxQcm9wZXJ0eShmcm9udG1hdHRlciwgU1VCVFlQX1BST1BFUlRZLCBuZXdWYWx1ZSk7XG4gICAgICBtYXRjaGVkID0gdHJ1ZTtcbiAgICB9KTtcbiAgICBpZiAobWF0Y2hlZCkgY2hhbmdlZCsrO1xuICB9XG4gIHJldHVybiBjaGFuZ2VkO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgbm9ybWFsaXplU3VidHlwTmFtZSxcbiAgaXNFbXB0eVZhbHVlLFxuICBnZXRTdWJ0eXBOYW1lcyxcbiAgZ2V0U3VidHlwLFxuICBlbnN1cmVTdWJ0eXAsXG4gIGlzU3VidHlwTWFudWFsLFxuICBzZXRTdWJ0eXBNYW51YWwsXG4gIHNldEFsbFN1YnR5cHNNYW51YWwsXG4gIG1vdmVUeXBTdWJ0eXBzLFxuICBkZWxldGVUeXBTdWJ0eXBzLFxuICBtZXJnZVR5cFN1YnR5cHMsXG4gIHJlbmFtZVN1YnR5cCxcbiAgZ2V0U2VjdGlvbk9yZGVyLFxuICByZW9yZGVyU3VidHlwcyxcbiAgZGVsZXRlU3VidHlwLFxuICBtZXJnZVN1YnR5cHMsXG4gIHJlbmFtZVN1YnR5cEluTm90ZXMsXG59O1xuIiwgIi8vIFN0YXRlbGVzcyBoZWxwZXJzIGFyb3VuZCBUWVAgbmFtZXMsIHNvcnRpbmcgYW5kIG1lc3NhZ2UgdGV4dC5cblxuLy8gVFlQIG5hbWVzIHR5cGVkIGludG8gdGhlIGxpc3QgYXJlIGFsd2F5cyB1cHBlcmNhc2UuIFZhbHVlcyB3cml0dGVuIGRpcmVjdGx5XG4vLyBpbnRvIGEgbm90ZSdzIGZyb250bWF0dGVyIGFyZSBsZWZ0IGFsb25lIChzZWUgdGhlIHVucmVnaXN0ZXJlZCByb3dzIGluXG4vLyB0eXAtcGFuZS5qcykuXG5mdW5jdGlvbiBub3JtYWxpemVUeXBOYW1lKHJhdykge1xuICByZXR1cm4gcmF3LnRyaW0oKS50b1VwcGVyQ2FzZSgpO1xufVxuXG4vLyBcIjEgbm90ZVwiLCBcIjMgbm90ZXNcIi4gd29yZCBpcyB0aGUgRW5nbGlzaCBzaW5ndWxhcjsgaXJyZWd1bGFyIHBsdXJhbHMgYXJlXG4vLyBwYXNzZWQgZXhwbGljaXRseS5cbmZ1bmN0aW9uIHBsdXJhbChjb3VudCwgd29yZCwgcGx1cmFsV29yZCA9IGAke3dvcmR9c2ApIHtcbiAgcmV0dXJuIGAke2NvdW50fSAke2NvdW50ID09PSAxID8gd29yZCA6IHBsdXJhbFdvcmR9YDtcbn1cblxuLy8gXCJhXCIsIFwiYSBhbmQgYlwiLCBcImEsIGIgYW5kIGNcIi5cbmZ1bmN0aW9uIGpvaW5BbmQocGFydHMpIHtcbiAgcmV0dXJuIHBhcnRzLmxlbmd0aCA8PSAxID8gcGFydHMuam9pbihcIlwiKSA6IGAke3BhcnRzLnNsaWNlKDAsIC0xKS5qb2luKFwiLCBcIil9IGFuZCAke3BhcnRzW3BhcnRzLmxlbmd0aCAtIDFdfWA7XG59XG5cbi8vIEtleSBoaW50cyBhdCB0aGUgYm90dG9tIG9mIGEgcGlja2VyLCB3b3JkZWQgbGlrZSB0aG9zZSBvZiBPYnNpZGlhbidzIG93blxuLy8gc3VnZ2VzdGVycy4gZXNjUHVycG9zZTogdGhlIFN1YnR5cC1QaWNrZXIgc2F5cyBcInRvIGdvIGJhY2tcIiwgc2luY2UgRVNDIHRoZXJlXG4vLyByZXR1cm5zIHRvIHRoZSBUWVAgY2hvaWNlLlxuZnVuY3Rpb24gcGlja2VySW5zdHJ1Y3Rpb25zKGVzY1B1cnBvc2UgPSBcInRvIGNhbmNlbFwiKSB7XG4gIHJldHVybiBbXG4gICAgeyBjb21tYW5kOiBcIlx1MjE5MVx1MjE5M1wiLCBwdXJwb3NlOiBcInRvIG5hdmlnYXRlXCIgfSxcbiAgICB7IGNvbW1hbmQ6IFwiXHUyMUI1XCIsIHB1cnBvc2U6IFwidG8gY2hvb3NlXCIgfSxcbiAgICB7IGNvbW1hbmQ6IFwiZXNjXCIsIHB1cnBvc2U6IGVzY1B1cnBvc2UgfSxcbiAgXTtcbn1cblxuLy8gSHVlICgwLTM2MFx1MDBCMCkgb2YgYSBoZXggY29sb3IsIHNvIGNvbG9ycyBzb3J0IGFsb25nIHRoZSBzcGVjdHJ1bSBpbnN0ZWFkIG9mIGJ5XG4vLyBoZXggc3RyaW5nLiBBY2hyb21hdGljIGNvbG9ycyAoZ3JheS9ibGFjay93aGl0ZSkgaGF2ZSBubyBodWUgYW5kIHJldHVybiBudWxsO1xuLy8gY29tcGFyZVR5cHMga2VlcHMgdGhlbSBsYXN0IGluIGJvdGggZGlyZWN0aW9ucy5cbmZ1bmN0aW9uIGhleFRvSHVlKGhleCkge1xuICBjb25zdCBtYXRjaCA9IC9eIz8oWzAtOWEtZl17Nn0pJC9pLmV4ZWMoaGV4ID8/IFwiXCIpO1xuICBpZiAoIW1hdGNoKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgaW50ID0gcGFyc2VJbnQobWF0Y2hbMV0sIDE2KTtcbiAgY29uc3QgciA9ICgoaW50ID4+IDE2KSAmIDI1NSkgLyAyNTU7XG4gIGNvbnN0IGcgPSAoKGludCA+PiA4KSAmIDI1NSkgLyAyNTU7XG4gIGNvbnN0IGIgPSAoaW50ICYgMjU1KSAvIDI1NTtcbiAgY29uc3QgbWF4ID0gTWF0aC5tYXgociwgZywgYik7XG4gIGNvbnN0IG1pbiA9IE1hdGgubWluKHIsIGcsIGIpO1xuICBjb25zdCBkZWx0YSA9IG1heCAtIG1pbjtcbiAgaWYgKGRlbHRhID09PSAwKSByZXR1cm4gbnVsbDtcblxuICBsZXQgaHVlO1xuICBpZiAobWF4ID09PSByKSBodWUgPSAoKGcgLSBiKSAvIGRlbHRhKSAlIDY7XG4gIGVsc2UgaWYgKG1heCA9PT0gZykgaHVlID0gKGIgLSByKSAvIGRlbHRhICsgMjtcbiAgZWxzZSBodWUgPSAociAtIGcpIC8gZGVsdGEgKyA0O1xuICBodWUgKj0gNjA7XG4gIHJldHVybiBodWUgPCAwID8gaHVlICsgMzYwIDogaHVlO1xufVxuXG4vLyBTaGFyZWQgY29tcGFyaXNvbiBmb3IgVFlQIGFuZCBTVUJUWVAgbGlzdHMuIHR5cENvbG9ycyBtYXkgYmUgZW1wdHkgKGEgU3VidHlwXG4vLyBoYXMgbm8gY29sb3Igb2YgaXRzIG93bik7IHRoZSBcImNvbG9yXCIgbW9kZSBpcyB0aGVuIG5ldmVyIHNlbGVjdGVkLlxuZnVuY3Rpb24gY29tcGFyZVR5cHMobW9kZSwgYSwgYiwgY291bnRzLCB0eXBDb2xvcnMpIHtcbiAgY29uc3QgW2tleSwgZGlyXSA9IG1vZGUuc3BsaXQoXCItXCIpO1xuICBsZXQgY21wO1xuICBpZiAoa2V5ID09PSBcImNvdW50XCIpIHtcbiAgICBjbXAgPSAoY291bnRzLmdldChhKSA/PyAwKSAtIChjb3VudHMuZ2V0KGIpID8/IDApO1xuICAgIGlmIChkaXIgPT09IFwiZGVzY1wiKSBjbXAgPSAtY21wO1xuICB9IGVsc2UgaWYgKGtleSA9PT0gXCJjb2xvclwiKSB7XG4gICAgY29uc3QgaHVlQSA9IGhleFRvSHVlKHR5cENvbG9yc1thXSA/PyBudWxsKTtcbiAgICBjb25zdCBodWVCID0gaGV4VG9IdWUodHlwQ29sb3JzW2JdID8/IG51bGwpO1xuICAgIC8vIEFjaHJvbWF0aWMgY29sb3JzIHN0YXkgYXQgdGhlIGVuZCBpbiBib3RoIGRpcmVjdGlvbnMuXG4gICAgaWYgKGh1ZUEgPT09IG51bGwgJiYgaHVlQiA9PT0gbnVsbCkgY21wID0gMDtcbiAgICBlbHNlIGlmIChodWVBID09PSBudWxsKSBjbXAgPSAxO1xuICAgIGVsc2UgaWYgKGh1ZUIgPT09IG51bGwpIGNtcCA9IC0xO1xuICAgIGVsc2Uge1xuICAgICAgY21wID0gaHVlQSAtIGh1ZUI7XG4gICAgICBpZiAoZGlyID09PSBcImRlc2NcIikgY21wID0gLWNtcDtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgY21wID0gYS5sb2NhbGVDb21wYXJlKGIpO1xuICAgIGlmIChkaXIgPT09IFwiZGVzY1wiKSBjbXAgPSAtY21wO1xuICB9XG4gIHJldHVybiBjbXAgfHwgYS5sb2NhbGVDb21wYXJlKGIpO1xufVxuXG4vLyBcIm1hbnVhbFwiIGtlZXBzIHRoZSBnaXZlbiBvcmRlcjogaXQgaXMgdGhlIHN0b3JlZCBvcmRlciAoc2V0dGluZ3MudHlwcyxcbi8vIHJlYXJyYW5nZWQgYnkgZHJhZyAmIGRyb3ApLCB3aGljaCBubyBwYWlyd2lzZSBjb21wYXJpc29uIGNvdWxkIGRlcml2ZS5cbi8vIFVzZWQgYnkgbWFpbi5qcyAoZ2V0VHlwcykgYW5kIHR5cC1wYW5lLmpzIHNvIGJvdGggc2hvdyB0aGUgc2FtZSBvcmRlci5cbmZ1bmN0aW9uIHNvcnRUeXBzQnlNb2RlKHR5cHMsIG1vZGUsIGNvdW50cywgdHlwQ29sb3JzKSB7XG4gIGlmIChtb2RlID09PSBcIm1hbnVhbFwiKSByZXR1cm4gWy4uLnR5cHNdO1xuICByZXR1cm4gWy4uLnR5cHNdLnNvcnQoKGEsIGIpID0+IGNvbXBhcmVUeXBzKG1vZGUsIGEsIGIsIGNvdW50cywgdHlwQ29sb3JzKSk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyBub3JtYWxpemVUeXBOYW1lLCBwbHVyYWwsIGpvaW5BbmQsIHBpY2tlckluc3RydWN0aW9ucywgaGV4VG9IdWUsIGNvbXBhcmVUeXBzLCBzb3J0VHlwc0J5TW9kZSB9O1xuIiwgImNvbnN0IHsgZ2V0U3VidHlwIH0gPSByZXF1aXJlKFwiLi9zdWJ0eXBzXCIpO1xuXG4vLyBDb2xvciBvZiBhIFRZUCB3aXRob3V0IGl0cyBvd24gY29sb3IuIExpdmVzIGhlcmUgYmVjYXVzZSBjb2RlIGJlbG93IHRoZVxuLy8gdmlldyBuZWVkcyBpdCAoc2VlIG5hbWVDb2xvcik7IHR5cC1wYW5lLmpzIHJlLWV4cG9ydHMgaXQuXG5jb25zdCBERUZBVUxUX1RZUF9DT0xPUiA9IFwiIzg4ODg4OFwiO1xuXG4vLyAtLS0gU3VidHlwIGNvbG9ycyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBBIFN1YnR5cCBzdG9yZXMgbm8gY29sb3IsIG9ubHkgYW4gb2Zmc2V0IGZyb20gaXRzIFRZUCdzIGNvbG9yXG4vLyAoc2V0dGluZ3MudHlwU3VidHlwc1tUWVBdW1NVQlRZUF0uY29sb3IgPSB7IGgsIGwgfSkuIFRoZSByZWFsIGNvbG9yIGlzXG4vLyBjb21wdXRlZCBmcm9tIHRoZSBjdXJyZW50IFRZUCBjb2xvciBldmVyeSB0aW1lLCBzbyB3aGVuIHRoYXQgY2hhbmdlcyBhbGxcbi8vIFN1YnR5cHMgZm9sbG93IGFuZCBzdGF5IGluIHRoZSBmYW1pbHkuXG4vLyBUaGUgbWF0aCBydW5zIGluIE9LTENILCB3aGVyZSBhIGxpZ2h0bmVzcyBjaGFuZ2UgbG9va3MgYWJvdXQgZXF1YWxseSBzdHJvbmdcbi8vIGFjcm9zcyBodWVzIChpbiBIU0wgeWVsbG93IHdvdWxkIGJlIGZhciBicmlnaHRlciB0aGFuIGJsdWUpLiBXaXRob3V0IGFuXG4vLyBvZmZzZXQgYSBTdWJ0eXAgaGFzIHRoZSBUWVAgY29sb3IuXG4vLyAgIGg6IGh1ZSwgc2hpZnRlZCBpbiBkZWdyZWVzO1xuLy8gICBsOiBsaWdodG5lc3MgYXMgJSBvZiB0aGUgd2F5IHRvIHdoaXRlICgrKSBvciBibGFjayAoLSkuXG4vLyBUaGUgYWxsb3dlZCByYW5nZSBpcyBhIHNldHRpbmcgKHNldHRpbmdzLnN1YnR5cENvbG9yUmFuZ2VzKTsgYSBsYXJnZXIgc3RvcmVkXG4vLyBvZmZzZXQgaXMgY2xhbXBlZCB0byBpdC5cbi8vXG4vLyBUaGlzIGxpc3QgaXMgdGhlIHNpbmdsZSBzb3VyY2UgZm9yIHRoZSBwb3BvdmVyIHNsaWRlcnMsIHRoZSBzZXR0aW5nIGxpbWl0c1xuLy8gYW5kIHRoZSBjbGFtcGluZzsgY29tbWVudGluZyBhIGNoYW5uZWwgb3V0IHJlbW92ZXMgaXQgZXZlcnl3aGVyZS5cbi8vXG4vLyBTYXR1cmF0aW9uIGlzIGRpc2FibGVkLiBJdCBvbmNlIGNvbXBlbnNhdGVkIGZvciBjaHJvbWEgdGhhdCBsaWdodG5lc3MgYW5kXG4vLyBodWUgdG9vayBhd2F5OyBzaW5jZSBib3RoIG5vdyBjYXJyeSBjaHJvbWEgYWxvbmcgKHNlZSBjb21wdXRlQ29sb3JPZmZzZXQpLFxuLy8gaXQgY291bGQgb25seSBzYXkgXCJ0aGlzIFN1YnR5cCBob2xkcyBiYWNrXCIsIG5vdCB3b3J0aCBhIHRoaXJkIHNsaWRlci4gVG9cbi8vIHJldml2ZSBpdCwgdW5jb21tZW50IGl0IGhlcmUsIGluIERFRkFVTFRfU1VCVFlQX0NPTE9SX1JBTkdFUywgaW5cbi8vIGNvbXB1dGVDb2xvck9mZnNldCBhbmQgYXQgcmFuZ2VNYXgvcmFuZ2VEZXNjIGluIHNldHRpbmdzLmpzLlxuLy8gZG93bk9ubHk6IHRoZSBzbGlkZXIgb25seSBnb2VzIGZyb20gLWxpbWl0IHRvIDAgLSBhIFN1YnR5cCBtYXkgaG9sZCBiYWNrIGJ1dFxuLy8gbmV2ZXIgYmUgbG91ZGVyIHRoYW4gaXRzIFRZUC5cbmNvbnN0IFNVQlRZUF9DT0xPUl9DSEFOTkVMUyA9IFtcbiAgeyBrZXk6IFwiaFwiLCBsYWJlbDogXCJIdWVcIiwgdW5pdDogXCJcdTAwQjBcIiB9LFxuICAvLyB7IGtleTogXCJzXCIsIGxhYmVsOiBcIlNhdHVyYXRpb25cIiwgdW5pdDogXCIlXCIsIGRvd25Pbmx5OiB0cnVlIH0sXG4gIHsga2V5OiBcImxcIiwgbGFiZWw6IFwiTGlnaHRuZXNzXCIsIHVuaXQ6IFwiJVwiIH0sXG5dO1xuLy8gU3VidHlwcyBzaG91bGQgYWJvdmUgYWxsIGJlIGRpc3Rpbmd1aXNoYWJsZTogaHVlIGNvbnRyaWJ1dGVzIG1vc3QgYW5kIGdldHNcbi8vIHRoZSB3aWRlc3QgcmFuZ2UsIGxpZ2h0bmVzcyBhcyB0aGUgc2Vjb25kIGNsZWFyIGF4aXMgZ2V0cyBwbGVudHkgdG9vLlxuY29uc3QgREVGQVVMVF9TVUJUWVBfQ09MT1JfUkFOR0VTID0geyBoOiAzNSwgLyogczogNDAsICovIGw6IDQwIH07XG5cbmZ1bmN0aW9uIGNvbG9yUmFuZ2Uoc2V0dGluZ3MsIGtleSkge1xuICBjb25zdCB2YWx1ZSA9IE51bWJlcihzZXR0aW5ncy5zdWJ0eXBDb2xvclJhbmdlcz8uW2tleV0pO1xuICByZXR1cm4gTnVtYmVyLmlzRmluaXRlKHZhbHVlKSAmJiB2YWx1ZSA+PSAwID8gdmFsdWUgOiBERUZBVUxUX1NVQlRZUF9DT0xPUl9SQU5HRVNba2V5XTtcbn1cblxuLy8gU2xpZGVyIHJhbmdlIC0gb25lIHBsYWNlIGZvciBwb3BvdmVyLCBjbGFtcGluZyBhbmQgZ3JhZGllbnQgcHJldmlldyBzbyB0aGV5XG4vLyBjYW4ndCBkcmlmdCBhcGFydC5cbmZ1bmN0aW9uIGNoYW5uZWxCb3VuZHMoc2V0dGluZ3MsIGtleSkge1xuICBjb25zdCByYW5nZSA9IGNvbG9yUmFuZ2Uoc2V0dGluZ3MsIGtleSk7XG4gIHJldHVybiBTVUJUWVBfQ09MT1JfQ0hBTk5FTFMuZmluZCgoY2hhbm5lbCkgPT4gY2hhbm5lbC5rZXkgPT09IGtleSk/LmRvd25Pbmx5ID8gWy1yYW5nZSwgMF0gOiBbLXJhbmdlLCByYW5nZV07XG59XG5cbi8vIEEgU3VidHlwJ3Mgb2Zmc2V0LCBjbGFtcGVkIHRvIHRoZSBjb25maWd1cmVkIGxpbWl0cy5cbmZ1bmN0aW9uIGNsYW1wZWRPZmZzZXQoc2V0dGluZ3MsIG9mZnNldCkge1xuICBpZiAoIW9mZnNldCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHJlc3VsdCA9IHt9O1xuICBmb3IgKGNvbnN0IHsga2V5IH0gb2YgU1VCVFlQX0NPTE9SX0NIQU5ORUxTKSB7XG4gICAgY29uc3QgW21pbiwgbWF4XSA9IGNoYW5uZWxCb3VuZHMoc2V0dGluZ3MsIGtleSk7XG4gICAgcmVzdWx0W2tleV0gPSBNYXRoLm1pbihtYXgsIE1hdGgubWF4KG1pbiwgTnVtYmVyKG9mZnNldFtrZXldKSB8fCAwKSk7XG4gIH1cbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuY29uc3QgdG9MaW5lYXIgPSAoYykgPT4gKGMgPD0gMC4wNDA0NSA/IGMgLyAxMi45MiA6ICgoYyArIDAuMDU1KSAvIDEuMDU1KSAqKiAyLjQpO1xuY29uc3QgdG9HYW1tYSA9IChjKSA9PiAoYyA8PSAwLjAwMzEzMDggPyAxMi45MiAqIGMgOiAxLjA1NSAqIGMgKiogKDEgLyAyLjQpIC0gMC4wNTUpO1xuXG5mdW5jdGlvbiBoZXhUb09rbGNoKGhleCkge1xuICBjb25zdCBtYXRjaCA9IC9eIz8oWzAtOWEtZl17Nn0pJC9pLmV4ZWMoaGV4ID8/IFwiXCIpO1xuICBpZiAoIW1hdGNoKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgaW50ID0gcGFyc2VJbnQobWF0Y2hbMV0sIDE2KTtcbiAgY29uc3QgW3IsIGcsIGJdID0gWyhpbnQgPj4gMTYpICYgMjU1LCAoaW50ID4+IDgpICYgMjU1LCBpbnQgJiAyNTVdLm1hcCgoYykgPT4gdG9MaW5lYXIoYyAvIDI1NSkpO1xuICBjb25zdCBsID0gTWF0aC5jYnJ0KDAuNDEyMjIxNDcwOCAqIHIgKyAwLjUzNjMzMjUzNjMgKiBnICsgMC4wNTE0NDU5OTI5ICogYik7XG4gIGNvbnN0IG0gPSBNYXRoLmNicnQoMC4yMTE5MDM0OTgyICogciArIDAuNjgwNjk5NTQ1MSAqIGcgKyAwLjEwNzM5Njk1NjYgKiBiKTtcbiAgY29uc3QgcyA9IE1hdGguY2JydCgwLjA4ODMwMjQ2MTkgKiByICsgMC4yODE3MTg4Mzc2ICogZyArIDAuNjI5OTc4NzAwNSAqIGIpO1xuICBjb25zdCBMID0gMC4yMTA0NTQyNTUzICogbCArIDAuNzkzNjE3Nzg1ICogbSAtIDAuMDA0MDcyMDQ2OCAqIHM7XG4gIGNvbnN0IEEgPSAxLjk3Nzk5ODQ5NTEgKiBsIC0gMi40Mjg1OTIyMDUgKiBtICsgMC40NTA1OTM3MDk5ICogcztcbiAgY29uc3QgQiA9IDAuMDI1OTA0MDM3MSAqIGwgKyAwLjc4Mjc3MTc2NjIgKiBtIC0gMC44MDg2NzU3NjYgKiBzO1xuICByZXR1cm4geyBMLCBDOiBNYXRoLmh5cG90KEEsIEIpLCBIOiAoKE1hdGguYXRhbjIoQiwgQSkgKiAxODApIC8gTWF0aC5QSSArIDM2MCkgJSAzNjAgfTtcbn1cblxuLy8gTGluZWFyIHNSR0I7IGNoYW5uZWxzIG1heSBmYWxsIG91dHNpZGUgMC4uMSAob3V0IG9mIGdhbXV0KS5cbmZ1bmN0aW9uIG9rbGNoVG9MaW5lYXIoeyBMLCBDLCBIIH0pIHtcbiAgY29uc3QgQSA9IEMgKiBNYXRoLmNvcygoSCAqIE1hdGguUEkpIC8gMTgwKTtcbiAgY29uc3QgQiA9IEMgKiBNYXRoLnNpbigoSCAqIE1hdGguUEkpIC8gMTgwKTtcbiAgY29uc3QgbCA9IChMICsgMC4zOTYzMzc3Nzc0ICogQSArIDAuMjE1ODAzNzU3MyAqIEIpICoqIDM7XG4gIGNvbnN0IG0gPSAoTCAtIDAuMTA1NTYxMzQ1OCAqIEEgLSAwLjA2Mzg1NDE3MjggKiBCKSAqKiAzO1xuICBjb25zdCBzID0gKEwgLSAwLjA4OTQ4NDE3NzUgKiBBIC0gMS4yOTE0ODU1NDggKiBCKSAqKiAzO1xuICByZXR1cm4gW1xuICAgIDQuMDc2NzQxNjYyMSAqIGwgLSAzLjMwNzcxMTU5MTMgKiBtICsgMC4yMzA5Njk5MjkyICogcyxcbiAgICAtMS4yNjg0MzgwMDQ2ICogbCArIDIuNjA5NzU3NDAxMSAqIG0gLSAwLjM0MTMxOTM5NjUgKiBzLFxuICAgIC0wLjAwNDE5NjA4NjMgKiBsIC0gMC43MDM0MTg2MTQ3ICogbSArIDEuNzA3NjE0NzAxICogcyxcbiAgXTtcbn1cblxuY29uc3QgaW5HYW11dCA9IChyZ2IpID0+IHJnYi5ldmVyeSgoYykgPT4gYyA+PSAtMC4wMDAxICYmIGMgPD0gMS4wMDAxKTtcblxuLy8gTGFyZ2VzdCBjaHJvbWEgc1JHQiBjYW4gc2hvdyBhdCB0aGlzIGxpZ2h0bmVzcyBhbmQgaHVlLiBUaGUgbGltaXQgdmFyaWVzIGFcbi8vIGxvdCAocHVyZSB5ZWxsb3cgb25seSBjYXJyaWVzIG11Y2ggY2hyb21hIGp1c3QgYmVsb3cgd2hpdGUsIGJsdWUgaW4gdGhlXG4vLyBtaWRkbGUpLCB3aGljaCBpcyBleGFjdGx5IHdoZXJlIGFueSBtYXRoIGhvbGRpbmcgY2hyb21hIGFic29sdXRlIGJyZWFrcy5cbmZ1bmN0aW9uIG1heENocm9tYShMLCBIKSB7XG4gIGxldCBsb3cgPSAwO1xuICBsZXQgaGlnaCA9IDAuNDsgLy8gYWJvdmUgdGhlIHNSR0IgbWF4aW11bSAofjAuMzIpXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgMjA7IGkrKykge1xuICAgIGNvbnN0IG1pZCA9IChsb3cgKyBoaWdoKSAvIDI7XG4gICAgaWYgKGluR2FtdXQob2tsY2hUb0xpbmVhcih7IEwsIEM6IG1pZCwgSCB9KSkpIGxvdyA9IG1pZDtcbiAgICBlbHNlIGhpZ2ggPSBtaWQ7XG4gIH1cbiAgcmV0dXJuIGxvdztcbn1cblxuLy8gT3V0LW9mLWdhbXV0IGNvbG9ycyBsb3NlIGNocm9tYSB1bnRpbCB0aGV5IGZpdDsgaHVlIGFuZCBsaWdodG5lc3Mgc3RheS5cbi8vIEZvciBhcHBseUNvbG9yT2Zmc2V0IG9ubHkgYSBzYWZldHkgbmV0LCBzaW5jZSBjaHJvbWEgaXMgYWxyZWFkeSBhIHNoYXJlIG9mXG4vLyB0aGUgZGlzcGxheWFibGUgbWF4aW11bSB0aGVyZS5cbmZ1bmN0aW9uIG9rbGNoVG9IZXgoY29sb3IpIHtcbiAgbGV0IHJnYiA9IG9rbGNoVG9MaW5lYXIoY29sb3IpO1xuICBpZiAoIWluR2FtdXQocmdiKSkgcmdiID0gb2tsY2hUb0xpbmVhcih7IC4uLmNvbG9yLCBDOiBtYXhDaHJvbWEoY29sb3IuTCwgY29sb3IuSCkgfSk7XG4gIHJldHVybiAoXG4gICAgXCIjXCIgK1xuICAgIHJnYlxuICAgICAgLm1hcCgoYykgPT4gTWF0aC5yb3VuZChNYXRoLm1pbigxLCBNYXRoLm1heCgwLCB0b0dhbW1hKE1hdGgubWluKDEsIE1hdGgubWF4KDAsIGMpKSkpKSAqIDI1NSkpXG4gICAgICAubWFwKChjKSA9PiBjLnRvU3RyaW5nKDE2KS5wYWRTdGFydCgyLCBcIjBcIikpXG4gICAgICAuam9pbihcIlwiKVxuICApO1xufVxuXG4vLyBMaWdodG5lc3Mgb2YgYSBodWUncyBjdXNwLCB3aGVyZSBpdCBjYXJyaWVzIHRoZSBtb3N0IGNocm9tYS4gbWF4Q2hyb21hIHJpc2VzXG4vLyB1cCB0byBpdCBhbmQgZmFsbHMgYWZ0ZXIsIHNvIHRoZSBwZWFrIGNhbiBiZSBuYXJyb3dlZCBkb3duLiBPbmUgdmFsdWUgcGVyXG4vLyBodWUgYW5kIHRoZSBzZWFyY2ggaXMgY29zdGx5LCBzbyBpdCBpcyBjYWNoZWQgcGVyIHdob2xlIGRlZ3JlZS5cbmNvbnN0IGN1c3BDYWNoZSA9IG5ldyBNYXAoKTtcblxuLy8gQWJvdmUgdGhpcyBhIGNvbG9yIGNvdW50cyBhcyBjaHJvbWF0aWMuIEEgcHVyZSBncmF5IGNvbWVzIGJhY2sgZnJvbVxuLy8gaGV4VG9Pa2xjaCB3aXRoIGNocm9tYSBhcm91bmQgMmUtOCBhbmQgYW4gYXJiaXRyYXJ5IGh1ZSAocm91bmRlZCBtYXRyaXhcbi8vIGNvbnN0YW50cyk7IHRlc3RpbmcgXCI+IDBcIiBtYWRlIGEgZ3JheSBmb2xsb3cgdGhlIGN1c3Agb2YgYSBodWUgaXQgZG9lc24ndFxuLy8gaGF2ZS4gRmFyIGJlbG93IGFueXRoaW5nIHZpc2libGUgaW4gOCBiaXQgKG9uZSBzdGVwIGlzIGFib3V0IDAuMDAyKS5cbmNvbnN0IE5FVVRSQUxfQ0hST01BID0gMWUtNDtcblxuZnVuY3Rpb24gY3VzcExpZ2h0bmVzcyhIKSB7XG4gIGNvbnN0IGtleSA9IE1hdGgucm91bmQoSCkgJSAzNjA7XG4gIGNvbnN0IGNhY2hlZCA9IGN1c3BDYWNoZS5nZXQoa2V5KTtcbiAgaWYgKGNhY2hlZCAhPT0gdW5kZWZpbmVkKSByZXR1cm4gY2FjaGVkO1xuICBsZXQgbG93ID0gMDtcbiAgbGV0IGhpZ2ggPSAxO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IDI0OyBpKyspIHtcbiAgICBjb25zdCB0aGlyZCA9IChoaWdoIC0gbG93KSAvIDM7XG4gICAgaWYgKG1heENocm9tYShsb3cgKyB0aGlyZCwga2V5KSA8IG1heENocm9tYShoaWdoIC0gdGhpcmQsIGtleSkpIGxvdyArPSB0aGlyZDtcbiAgICBlbHNlIGhpZ2ggLT0gdGhpcmQ7XG4gIH1cbiAgY29uc3QgcmVzdWx0ID0gKGxvdyArIGhpZ2gpIC8gMjtcbiAgY3VzcENhY2hlLnNldChrZXksIHJlc3VsdCk7XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbi8vIFRoZSBzYW1lIGxpZ2h0bmVzcywgbWVhc3VyZWQgYWdhaW5zdCB0aGUgdGFyZ2V0IGh1ZSdzIGN1c3AgaW5zdGVhZCBvZiBpdHNcbi8vIG93bjogY3VzcCBtYXBzIHRvIGN1c3AsIGJsYWNrIHRvIGJsYWNrLCB3aGl0ZSB0byB3aGl0ZSwgbGluZWFyIGluIGJldHdlZW4uXG4vLyBXaXRob3V0IGEgaHVlIHNoaWZ0IEwgY29tZXMgYmFjayB1bmNoYW5nZWQuXG5mdW5jdGlvbiByZW1hcFRvQ3VzcChMLCBmcm9tSCwgdG9IKSB7XG4gIGNvbnN0IGZyb20gPSBjdXNwTGlnaHRuZXNzKGZyb21IKTtcbiAgY29uc3QgdG8gPSBjdXNwTGlnaHRuZXNzKHRvSCk7XG4gIGlmIChMIDw9IGZyb20pIHJldHVybiBmcm9tID4gMCA/IChMIC8gZnJvbSkgKiB0byA6IHRvO1xuICByZXR1cm4gZnJvbSA8IDEgPyB0byArICgoTCAtIGZyb20pIC8gKDEgLSBmcm9tKSkgKiAoMSAtIHRvKSA6IHRvO1xufVxuXG4vLyBUaGUgdHdvIGdhbXV0IHNlYXJjaGVzIGNvc3QgYWJvdXQgMTAgXHUwMEI1cyBwZXIgY29sb3IgLSB0b28gbXVjaCB3aGVuIHRoZSBmaWxlXG4vLyB0cmVlIG9yIGdyYXBoIGFza3MgZm9yIGV2ZXJ5IGZpbGUgKHNlZSBjb2xvckZvckZpbGUpLiBUaGVyZSBhcmUgb25seSBhXG4vLyBoYW5kZnVsIG9mIGRpc3RpbmN0IGNvbG9ycywgc28gYSBjYWNoZSBzdWZmaWNlczsgZHJhZ2dpbmcgYSBzbGlkZXIgYWRkc1xuLy8gZXZlcnkgaW50ZXJtZWRpYXRlIHZhbHVlLCBoZW5jZSB0aGUgb2NjYXNpb25hbCByZXNldC5cbmNvbnN0IG9mZnNldENhY2hlID0gbmV3IE1hcCgpO1xuXG5mdW5jdGlvbiBhcHBseUNvbG9yT2Zmc2V0KGhleCwgb2Zmc2V0KSB7XG4gIGlmICghb2Zmc2V0KSByZXR1cm4gaGV4O1xuICBjb25zdCBjYWNoZUtleSA9IGhleCArIFwifFwiICsgKG9mZnNldC5oID8/IDApICsgXCJ8XCIgKyAob2Zmc2V0LmwgPz8gMCk7XG4gIGNvbnN0IGNhY2hlZCA9IG9mZnNldENhY2hlLmdldChjYWNoZUtleSk7XG4gIGlmIChjYWNoZWQgIT09IHVuZGVmaW5lZCkgcmV0dXJuIGNhY2hlZDtcbiAgY29uc3QgcmVzdWx0ID0gY29tcHV0ZUNvbG9yT2Zmc2V0KGhleCwgb2Zmc2V0KTtcbiAgaWYgKG9mZnNldENhY2hlLnNpemUgPiA1MDApIG9mZnNldENhY2hlLmNsZWFyKCk7XG4gIG9mZnNldENhY2hlLnNldChjYWNoZUtleSwgcmVzdWx0KTtcbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuLy8gQm90aCBzbGlkZXJzIGFjdCByZWxhdGl2ZSB0byB0aGUgVFlQIGNvbG9yIHNvIHRoZSBTdWJ0eXAgc3RheXMgaW4gdGhlXG4vLyBmYW1pbHkuIEFic29sdXRlIHZhbHVlcyBkb24ndCBrZWVwIHRoZWlyIHByb21pc2UsIGJlY2F1c2UgaG93IG11Y2ggY29sb3Jcbi8vIHNSR0IgYWxsb3dzIGRlcGVuZHMgb24gbGlnaHRuZXNzIEFORCBodWU6XG4vLyAgIGw6IHNoYXJlIG9mIHRoZSB3YXkgdG8gd2hpdGUgKCspIG9yIGJsYWNrICgtKS4gQWJzb2x1dGUgT0tMQ0ggcG9pbnRzIHJhbiBhXG4vLyAgICAgIGxpZ2h0IFRZUCBjb2xvciBpbnRvIHB1cmUgd2hpdGUgaW4gdGhlIGZpcnN0IGhhbGYgb2YgdGhlIHNsaWRlci5cbi8vICAgaDogZGVncmVlcyAtIHRoZSBvbmx5IGFic29sdXRlIG9uZSwgQlVUIGl0IGNhcnJpZXMgbGlnaHRuZXNzIGFsb25nIChzZWVcbi8vICAgICAgcmVtYXBUb0N1c3ApLiBFYWNoIGh1ZSBwZWFrcyBhdCBhIGRpZmZlcmVudCBsaWdodG5lc3MgKHllbGxvdyBhdCBMIDAuOTIsXG4vLyAgICAgIG9yYW5nZSAwLjc4LCBibHVlIDAuNDkpLiBUdXJuaW5nIGEgbGlnaHQgeWVsbG93IHRvIG9yYW5nZSBhdCBmaXhlZFxuLy8gICAgICBsaWdodG5lc3MgbGFuZHMgZmFyIGFib3ZlIG9yYW5nZSdzIGN1c3AsIHdoZXJlIHRoZXJlIGlzIGhhcmRseSBhbnlcbi8vICAgICAgY2hyb21hIGxlZnQ6IGEgd2FzaGVkLW91dCBwYXN0ZWwuIEZvbGxvd2luZyB0aGUgY3VzcCBrZWVwcyB0aGUgY29sb3Jcbi8vICAgICAgc3RyZW5ndGggbmVhcmx5IGNvbnN0YW50IHRocm91Z2ggdGhlIHR1cm4uXG4vLyBDaHJvbWEgaXMgdGhlbiBzaW1wbHkgYSBzaGFyZSBvZiB0aGUgY2VpbGluZyAoYmFzZS5DIC8gbWF4Q2hyb21hIGF0IHRoZVxuLy8gc3RhcnQsIHRpbWVzIG1heENocm9tYSBhdCB0aGUgdGFyZ2V0KTsgb25seSB3aXRoIHJlbGF0ZWQgbGlnaHRuZXNzZXMgYXJlXG4vLyB0d28gaHVlcycgY2VpbGluZ3MgY29tcGFyYWJsZS5cbi8vXG4vLyBOb3RlIHdoYXQgdGhhdCBzaGFyZSBpczogYSBzdGF0ZW1lbnQgYWJvdXQgc1JHQiwgbm90IGFib3V0IHBlcmNlcHRpb24uIEl0XG4vLyBrZWVwcyBcImVxdWFsbHkgZXhoYXVzdGVkXCIsIG5vdCBcImVxdWFsbHkgY29sb3JmdWxcIiAoY29uc3RhbnQgQykgbm9yIFwiZXF1YWxseVxuLy8gc2F0dXJhdGVkXCIgKGNvbnN0YW50IEMvTCkuIFNvIHRoZSBtb2RlbCBpcyB0aWVkIHRvIHNSR0I7IGFmdGVyIGEgaHVlIHR1cm4gYVxuLy8gU3VidHlwIGlzIGVxdWFsbHkgZW1waGF0aWMgcmF0aGVyIHRoYW4gZXF1YWxseSBsaWdodCAoYSBkZXNpZ24gY2hvaWNlKTsgYW5kXG4vLyBjaHJvbWEgaXNuJ3QgbW9ub3RvbmljIGluIGxpZ2h0bmVzcyAtIGFib3ZlIGl0cyBjdXNwIGEgVFlQIGNvbG9yIGZpcnN0IGdhaW5zXG4vLyBjaHJvbWEgZ29pbmcgZG93biwgdGhlbiBsb3NlcyBpdCAoIzc4NzhkYyBoYXMgbW9yZSBhdCAtMjAgJSB0aGFuIGF0IDAgJSBvclxuLy8gLTQwICUpLiBGaW5lIGZvciBjb2xvcmVkIGZpbGUgbmFtZXM7IGEgc3RyaWN0ZXIgbW9kZWwgbmVlZHMgYSBkaWZmZXJlbnRcbi8vIHJlZmVyZW5jZSwgbm90IHBhdGNoZWQgZm9ybXVsYXMuXG4vL1xuLy8gT0tMYWIgaXRzZWxmIGlzIG9mZiBpbiB0aGUgYmx1ZSByYW5nZSAoSCAyNjAtMjkwKTogYmx1ZSBkcmlmdHMgdG93YXJkIHZpb2xldFxuLy8gd2hlbiBsaWdodGVuZWQgd2hpbGUgdGhlIG51bWJlcnMgc2F5IHRoZSBodWUgaXMgY29uc3RhbnQuIENoZWNrIHN1Y2ggVFlQXG4vLyBjb2xvcnMgYnkgZXllLlxuZnVuY3Rpb24gY29tcHV0ZUNvbG9yT2Zmc2V0KGhleCwgb2Zmc2V0KSB7XG4gIGNvbnN0IGJhc2UgPSBoZXhUb09rbGNoKGhleCk7XG4gIGlmICghYmFzZSkgcmV0dXJuIGhleDtcbiAgY29uc3QgSCA9IChiYXNlLkggKyAob2Zmc2V0LmggPz8gMCkgKyAzNjApICUgMzYwO1xuICBjb25zdCBiYXNlQ2VpbGluZyA9IG1heENocm9tYShiYXNlLkwsIGJhc2UuSCk7XG4gIC8vIEEgZ3JheSBUWVAgY29sb3Igc3RheXMgZ3JheTsgaXRzIGh1ZSBtZWFucyBub3RoaW5nLCBzbyB0aGVyZSBpcyBubyBjdXNwIHRvXG4gIC8vIGZvbGxvdyBlaXRoZXIuXG4gIGNvbnN0IG5ldXRyYWwgPSBiYXNlLkMgPCBORVVUUkFMX0NIUk9NQSB8fCBiYXNlQ2VpbGluZyA8PSAwO1xuICBjb25zdCByZWxhdGl2ZSA9IG5ldXRyYWwgPyAwIDogYmFzZS5DIC8gYmFzZUNlaWxpbmc7XG4gIGNvbnN0IHNoaWZ0ZWQgPSBuZXV0cmFsID8gYmFzZS5MIDogcmVtYXBUb0N1c3AoYmFzZS5MLCBiYXNlLkgsIEgpO1xuICBjb25zdCBzaGFyZSA9IChvZmZzZXQubCA/PyAwKSAvIDEwMDtcbiAgY29uc3QgTCA9IE1hdGgubWluKDEsIE1hdGgubWF4KDAsIHNoaWZ0ZWQgKyBzaGFyZSAqIChzaGFyZSA+PSAwID8gMSAtIHNoaWZ0ZWQgOiBzaGlmdGVkKSkpO1xuICBjb25zdCBDID0gcmVsYXRpdmUgKiBtYXhDaHJvbWEoTCwgSCk7IC8qICogKDEgKyAob2Zmc2V0LnMgPz8gMCkgLyAxMDApIC0gc2F0dXJhdGlvbiBkaXNhYmxlZCAqL1xuICByZXR1cm4gb2tsY2hUb0hleCh7IEwsIEM6IE1hdGgubWF4KDAsIEMpLCBIIH0pO1xufVxuXG5mdW5jdGlvbiBoYXNDb2xvck9mZnNldChvZmZzZXQpIHtcbiAgcmV0dXJuICEhb2Zmc2V0ICYmIFNVQlRZUF9DT0xPUl9DSEFOTkVMUy5zb21lKCh7IGtleSB9KSA9PiAob2Zmc2V0W2tleV0gPz8gMCkgIT09IDApO1xufVxuXG4vLyBBIFN1YnR5cCdzIGNvbG9yICh0aGUgVFlQJ3Mgd2hpbGUgaXQgaGFzIG5vIG9mZnNldCk7IG51bGwgaWYgdGhlIFRZUCBpdHNlbGZcbi8vIGhhcyBubyBjb2xvci5cbmZ1bmN0aW9uIHN1YnR5cENvbG9yKHNldHRpbmdzLCB0eXAsIHN1YnR5cCkge1xuICBjb25zdCB0eXBDb2xvciA9IHNldHRpbmdzLnR5cENvbG9yc1t0eXBdID8/IG51bGw7XG4gIGlmICghdHlwQ29sb3IgfHwgIXN1YnR5cCkgcmV0dXJuIHR5cENvbG9yO1xuICBjb25zdCBvZmZzZXQgPSBjbGFtcGVkT2Zmc2V0KHNldHRpbmdzLCBnZXRTdWJ0eXAoc2V0dGluZ3MsIHR5cCwgc3VidHlwKT8uY29sb3IpO1xuICByZXR1cm4gaGFzQ29sb3JPZmZzZXQob2Zmc2V0KSA/IGFwcGx5Q29sb3JPZmZzZXQodHlwQ29sb3IsIG9mZnNldCkgOiB0eXBDb2xvcjtcbn1cblxuLy8gRG9lcyB0aGUgU3VidHlwIGhhdmUgYW4gb2Zmc2V0IG9mIGl0cyBvd24gKGVmZmVjdGl2ZSB3aXRoaW4gdGhlIGxpbWl0cyk/XG5mdW5jdGlvbiBzdWJ0eXBIYXNPd25Db2xvcihzZXR0aW5ncywgdHlwLCBzdWJ0eXApIHtcbiAgcmV0dXJuIGhhc0NvbG9yT2Zmc2V0KGNsYW1wZWRPZmZzZXQoc2V0dGluZ3MsIGdldFN1YnR5cChzZXR0aW5ncywgdHlwLCBzdWJ0eXApPy5jb2xvcikpO1xufVxuXG4vLyBDb2xvciBvZiBhIFRZUCBvciBTdWJ0eXAgbmFtZSAtIHNoYXJlZCBieSB0aGUgcGlja2VyICh0eXAtcGlja2VyLmpzKSBhbmQgdGhlXG4vLyBTdWJ0eXAgcHJldmlldyBpbiB0aGUgVFlQLUxpc3Qgc28gdGhleSBjYW4ndCBkcmlmdCBhcGFydC4gV2l0aCBzdWJ0eXAsIHRoZVxuLy8gU3VidHlwIGNvbG9yLCBidXQgb25seSBpZiB0aGUgXCJTdWJ0eXBcIiBzdWItdG9nZ2xlIG9mIFwiVFlQLVBhbmVcIiBhbGxvd3MgaXQuXG4vLyBpc0RlZmF1bHQgbWVhbnMgYSBob2xsb3cgcmluZyBpbnN0ZWFkIG9mIGEgZmlsbGVkIGRvdCAoc2VlIHBhaW50Q29sb3JEb3QpLlxuZnVuY3Rpb24gbmFtZUNvbG9yKHNldHRpbmdzLCB0eXAsIHN1YnR5cCA9IG51bGwpIHtcbiAgY29uc3QgdXNlU3VidHlwID0gISFzdWJ0eXAgJiYgc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0U3VidHlwO1xuICBjb25zdCB0eXBDb2xvciA9IHNldHRpbmdzLnR5cENvbG9yc1t0eXBdID8/IG51bGw7XG4gIHJldHVybiB7XG4gICAgY29sb3I6ICh1c2VTdWJ0eXAgPyBzdWJ0eXBDb2xvcihzZXR0aW5ncywgdHlwLCBzdWJ0eXApIDogdHlwQ29sb3IpID8/IERFRkFVTFRfVFlQX0NPTE9SLFxuICAgIGlzRGVmYXVsdDogIXR5cENvbG9yIHx8ICh1c2VTdWJ0eXAgJiYgIXN1YnR5cEhhc093bkNvbG9yKHNldHRpbmdzLCB0eXAsIHN1YnR5cCkpLFxuICB9O1xufVxuXG4vLyBDb2xvciBkb3QgKFRZUC1MaXN0LCBkZXRhaWwgdmlldywgcGlja2VycywgZGlhbG9ncyk6IGZpbGxlZCBmb3IgYW4gb3duXG4vLyBjb2xvciwgYSBob2xsb3cgcmluZyBmb3IgdGhlIGRlZmF1bHQgLSBncmF5IGZvciBhIFRZUCB3aXRob3V0IGEgY29sb3IsIHRoZVxuLy8gaW5oZXJpdGVkIFRZUCBjb2xvciBmb3IgYSBTdWJ0eXAgd2l0aG91dCBhbiBvZmZzZXQuXG5mdW5jdGlvbiBwYWludENvbG9yRG90KGVsLCBjb2xvciwgaXNEZWZhdWx0KSB7XG4gIGVsLnN0eWxlLmJhY2tncm91bmRDb2xvciA9IGlzRGVmYXVsdCA/IFwidHJhbnNwYXJlbnRcIiA6IGNvbG9yO1xuICBlbC5zdHlsZS5ib3hTaGFkb3cgPSBpc0RlZmF1bHQgPyBgaW5zZXQgMCAwIDAgbWF4KDEuNXB4LCAwLjE1ZW0pICR7Y29sb3J9YCA6IFwiXCI7XG59XG5cbi8vIHZpZXdLZXkgKG9wdGlvbmFsKTogdGhlIHZpZXcncyBrZXkgaW4gY29sb3JWaWV3cy4gSWYgaXRzIFwiPHZpZXdLZXk+U3VidHlwXCJcbi8vIHN1Yi10b2dnbGUgaXMgb24sIHRoZSBub3RlJ3MgU3VidHlwIGNvbG9yIGlzIHVzZWQgaW5zdGVhZCBvZiBpdHMgVFlQJ3MuXG5mdW5jdGlvbiBjb2xvckZvckZpbGUocGx1Z2luLCBmaWxlLCB2aWV3S2V5ID0gbnVsbCkge1xuICBjb25zdCB0eXAgPSBwbHVnaW4udHlwSW5kZXgudHlwT2YoZmlsZSk7XG4gIGlmICghdHlwKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgeyBzZXR0aW5ncyB9ID0gcGx1Z2luO1xuICBpZiAoIXZpZXdLZXkgfHwgIXNldHRpbmdzLmNvbG9yVmlld3NbYCR7dmlld0tleX1TdWJ0eXBgXSkgcmV0dXJuIHNldHRpbmdzLnR5cENvbG9yc1t0eXBdID8/IG51bGw7XG4gIHJldHVybiBzdWJ0eXBDb2xvcihzZXR0aW5ncywgdHlwLCBwbHVnaW4udHlwSW5kZXguc3VidHlwT2YoZmlsZSkpO1xufVxuXG4vLyAtLS0gSW5saW5lIGNvbG9ycyBpbiBvdGhlciB2aWV3cyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBFeHBsb3Jlciwgc2VhcmNoLCBSZWNlbnQgRmlsZXMsIGJhY2tsaW5rcywgYm9va21hcmtzLCB0aGUgbm90ZSB0aXRsZSBhbmRcbi8vIFwiQWxsIHByb3BlcnRpZXNcIiBhcmUgY29sb3JlZCB0aHJvdWdoIHN0eWxlLmNvbG9yIG9uIE9ic2lkaWFuJ3Mgb3duXG4vLyBlbGVtZW50cy4gVGhvc2Ugdmlld3Mgb25seSByZS1yZW5kZXIgbm93IGFuZCB0aGVuLCBzbyB0aGUgY29sb3JzIHdvdWxkIHN0YXlcbi8vIGFmdGVyIHRoZSBwbHVnaW4gaXMgZGlzYWJsZWQuIEV2ZXJ5IGVsZW1lbnQgY29sb3JlZCB0aGlzIHdheSBpcyBtYXJrZWQsIGFuZFxuLy8gb24gdW5sb2FkIGV4YWN0bHkgdGhlIG1hcmtlZCBvbmVzIGFyZSBjbGVhcmVkIC0gbmV2ZXIgYW4gaW5saW5lIGNvbG9yIHNvbWVcbi8vIG90aGVyIHBsdWdpbiBvciB0aGVtZSBwdXQgdGhlcmUuXG5jb25zdCBDT0xPUkVEX0FUVFIgPSBcImRhdGEtdHlwLWNvbG9yZWRcIjtcblxuLy8gY29sb3IgbnVsbC9cIlwiIHJlbW92ZXMgdGhlIGNvbG9yLCBidXQgb25seSBmcm9tIGFuIGVsZW1lbnQgd2UgY29sb3JlZC5cbi8vIHByaW9yaXR5OiBcImltcG9ydGFudFwiIHdoZXJlIGEgQ1NTIHJ1bGUgd2l0aCAhaW1wb3J0YW50IGNvbXBldGVzLlxuZnVuY3Rpb24gc2V0SW5saW5lQ29sb3IoZWwsIGNvbG9yLCBwcmlvcml0eSA9IFwiXCIpIHtcbiAgaWYgKGNvbG9yKSB7XG4gICAgZWwuc3R5bGUuc2V0UHJvcGVydHkoXCJjb2xvclwiLCBjb2xvciwgcHJpb3JpdHkpO1xuICAgIGVsLnNldEF0dHJpYnV0ZShDT0xPUkVEX0FUVFIsIFwiXCIpO1xuICB9IGVsc2UgaWYgKGVsLmhhc0F0dHJpYnV0ZShDT0xPUkVEX0FUVFIpKSB7XG4gICAgZWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoXCJjb2xvclwiKTtcbiAgICBlbC5yZW1vdmVBdHRyaWJ1dGUoQ09MT1JFRF9BVFRSKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBjbGVhcklubGluZUNvbG9ycyhkb2MpIHtcbiAgZm9yIChjb25zdCBlbCBvZiBkb2MucXVlcnlTZWxlY3RvckFsbChgWyR7Q09MT1JFRF9BVFRSfV1gKSkgc2V0SW5saW5lQ29sb3IoZWwsIG51bGwpO1xufVxuXG4vLyBUaGUgZG9jdW1lbnRzIG9mIGFsbCB3aW5kb3dzIChwb3Atb3V0cyBpbmNsdWRlZCksIGNvbGxlY3RlZCB0aHJvdWdoIHRoZWlyXG4vLyBsZWF2ZXMuXG5mdW5jdGlvbiBhbGxEb2N1bWVudHMoYXBwKSB7XG4gIGNvbnN0IGRvY3MgPSBuZXcgU2V0KCk7XG4gIGFwcC53b3Jrc3BhY2UuaXRlcmF0ZUFsbExlYXZlcygobGVhZikgPT4gZG9jcy5hZGQobGVhZi52aWV3LmNvbnRhaW5lckVsLm93bmVyRG9jdW1lbnQpKTtcbiAgcmV0dXJuIGRvY3M7XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICBzZXRJbmxpbmVDb2xvcixcbiAgY2xlYXJJbmxpbmVDb2xvcnMsXG4gIGFsbERvY3VtZW50cyxcbiAgY29sb3JGb3JGaWxlLFxuICBuYW1lQ29sb3IsXG4gIERFRkFVTFRfVFlQX0NPTE9SLFxuICBzdWJ0eXBDb2xvcixcbiAgYXBwbHlDb2xvck9mZnNldCxcbiAgaGFzQ29sb3JPZmZzZXQsXG4gIHN1YnR5cEhhc093bkNvbG9yLFxuICBwYWludENvbG9yRG90LFxuICBjb2xvclJhbmdlLFxuICBjaGFubmVsQm91bmRzLFxuICBjbGFtcGVkT2Zmc2V0LFxuICBTVUJUWVBfQ09MT1JfQ0hBTk5FTFMsXG4gIERFRkFVTFRfU1VCVFlQX0NPTE9SX1JBTkdFUyxcbn07XG4iLCAiY29uc3QgeyBDb25maXJtYXRpb25Nb2RhbCwgUGxhdGZvcm0gfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgbmFtZUNvbG9yLCBwYWludENvbG9yRG90LCBERUZBVUxUX1RZUF9DT0xPUiB9ID0gcmVxdWlyZShcIi4vdHlwLWNvbG9yc1wiKTtcblxuLy8gQSBUWVAgbmFtZSBpbiBydW5uaW5nIHRleHQgKGRpYWxvZ3MpOiBjb2xvcmVkIHdoZW4gXCJUWVAtUGFuZVwiIGNvbG9yaW5nIGlzIG9uXG4vLyAoY29sb3JWaWV3cy50eXBMaXN0KSwgb3RoZXJ3aXNlIGEgZG90IGJlZm9yZSBwbGFpbiB0ZXh0IC0gdGhlIHNhbWUgc3dpdGNoIGFzXG4vLyBpbiB0aGUgcGlja2VyIGFuZCB0aGUgbGlzdC4gVGhlIGNhbGxlciBwYXNzZXMgY29sb3Igc28gYSByZW5hbWUgY2FuIHVzZSB0aGVcbi8vIHNhbWUgKG9sZCkgY29sb3IgZm9yIG9sZCBhbmQgbmV3IG5hbWUuIGNvbG9yIG51bGwgPSBUWVAgd2l0aG91dCBhIGNvbG9yLlxuZnVuY3Rpb24gYXBwZW5kVHlwTmFtZShwYXJlbnRFbCwgcGx1Z2luLCB0eXAsIGNvbG9yKSB7XG4gIGlmIChwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0KSB7XG4gICAgY29uc3QgbmFtZUVsID0gcGFyZW50RWwuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtaW5saW5lLW5hbWVcIiwgdGV4dDogdHlwIH0pO1xuICAgIGlmIChjb2xvcikgbmFtZUVsLnN0eWxlLmNvbG9yID0gY29sb3I7XG4gIH0gZWxzZSB7XG4gICAgcGFpbnRDb2xvckRvdChwYXJlbnRFbC5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1pbmxpbmUtZG90XCIgfSksIGNvbG9yID8/IERFRkFVTFRfVFlQX0NPTE9SLCAhY29sb3IpO1xuICAgIHBhcmVudEVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLWlubGluZS1uYW1lXCIsIHRleHQ6IHR5cCB9KTtcbiAgfVxufVxuXG4vLyBMaWtlIGFwcGVuZFR5cE5hbWUgZm9yIGEgU3VidHlwIG9mIHR5cCwgaW4gdGhlIFN1YnR5cCBjb2xvciAoc2VlIG5hbWVDb2xvclxuLy8gaW4gdHlwLWNvbG9ycy5qcywgd2hpY2ggYWxzbyBob25vcnMgdGhlIFwiU3VidHlwXCIgc3ViLXRvZ2dsZSBvZiBcIlRZUC1QYW5lXCIpLlxuLy8gY29sb3JTdWJ0eXAgaXMgdGhlIFN1YnR5cCB3aG9zZSBjb2xvciBpcyB1c2VkIC0gYSByZW5hbWUgc2hvd3MgdGhlIG5ldyBuYW1lLFxuLy8gd2hpY2ggaGFzIG5vIGVudHJ5IHlldCwgaW4gdGhlIG9sZCBvbmUncyBjb2xvci4gQXMgd2l0aCBhcHBlbmRUeXBOYW1lLCBhIFRZUFxuLy8gd2l0aG91dCBhIGNvbG9yIGxlYXZlcyB0aGUgdGV4dCB1bmNvbG9yZWQuXG5mdW5jdGlvbiBhcHBlbmRTdWJ0eXBOYW1lKHBhcmVudEVsLCBwbHVnaW4sIHR5cCwgbmFtZSwgY29sb3JTdWJ0eXAgPSBuYW1lKSB7XG4gIGNvbnN0IHsgY29sb3IsIGlzRGVmYXVsdCB9ID0gbmFtZUNvbG9yKHBsdWdpbi5zZXR0aW5ncywgdHlwLCBjb2xvclN1YnR5cCk7XG4gIGlmIChwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0KSB7XG4gICAgY29uc3QgbmFtZUVsID0gcGFyZW50RWwuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtaW5saW5lLW5hbWVcIiwgdGV4dDogbmFtZSB9KTtcbiAgICBpZiAocGx1Z2luLnNldHRpbmdzLnR5cENvbG9yc1t0eXBdKSBuYW1lRWwuc3R5bGUuY29sb3IgPSBjb2xvcjtcbiAgfSBlbHNlIHtcbiAgICBwYWludENvbG9yRG90KHBhcmVudEVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLWlubGluZS1kb3RcIiB9KSwgY29sb3IsIGlzRGVmYXVsdCk7XG4gICAgcGFyZW50RWwuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtaW5saW5lLW5hbWVcIiwgdGV4dDogbmFtZSB9KTtcbiAgfVxufVxuXG4vLyBUaGUgc2FtZSBhcyBub2RlcyBmb3IgYSBDb25maXJtTW9kYWwgdGl0bGUgb3IgYm9keS5cbmNvbnN0IHR5cE5hbWVOb2RlID0gKHBsdWdpbiwgdHlwLCBjb2xvcikgPT4gY3JlYXRlRnJhZ21lbnQoKGYpID0+IGFwcGVuZFR5cE5hbWUoZiwgcGx1Z2luLCB0eXAsIGNvbG9yKSk7XG5jb25zdCBzdWJ0eXBOYW1lTm9kZSA9IChwbHVnaW4sIHR5cCwgbmFtZSwgY29sb3JTdWJ0eXAgPSBuYW1lKSA9PlxuICBjcmVhdGVGcmFnbWVudCgoZikgPT4gYXBwZW5kU3VidHlwTmFtZShmLCBwbHVnaW4sIHR5cCwgbmFtZSwgY29sb3JTdWJ0eXApKTtcblxuLy8gRmlsbHMgZWwgd2l0aCBhIHN0cmluZyBvciBhbiBhcnJheSBvZiBzdHJpbmdzIGFuZCBub2Rlcy5cbmZ1bmN0aW9uIGFwcGVuZFBhcnRzKGVsLCBwYXJ0cykge1xuICBmb3IgKGNvbnN0IHBhcnQgb2YgQXJyYXkuaXNBcnJheShwYXJ0cykgPyBwYXJ0cyA6IFtwYXJ0c10pIHtcbiAgICBpZiAodHlwZW9mIHBhcnQgPT09IFwic3RyaW5nXCIpIGVsLmFwcGVuZFRleHQocGFydCk7XG4gICAgZWxzZSBlbC5hcHBlbmRDaGlsZChwYXJ0KTtcbiAgfVxufVxuXG4vLyBUaGUgb25lIGNvbmZpcm1hdGlvbiBkaWFsb2cgb2YgdGhlIHBsdWdpbiwgYnVpbHQgb24gT2JzaWRpYW4ncyBvd25cbi8vIENvbmZpcm1hdGlvbk1vZGFsIC0gdGhlIGJhc2Ugb2YgaXRzIFwiRGVsZXRlIGZpbGVcIiBldGMuIC0gc28gbG9vaywgYnV0dG9uXG4vLyBvcmRlciBbQ2FuY2VsXSBbQWN0aW9uXSwgYm90dG9tIHNoZWV0IG9uIHBob25lcyBhbmQga2V5Ym9hcmQgZm9jdXMgbWF0Y2hcbi8vIE9ic2lkaWFuJ3MgZGlhbG9ncyBleGFjdGx5LlxuLy9cbi8vIExpa2UgT2JzaWRpYW4ncyBcIk1lcmdlIHByb3BlcnR5IC4uLiB3aXRoIC4uLj9cIiAoQWxsIHByb3BlcnRpZXMpLCB0aGVcbi8vIHF1ZXN0aW9uIGl0c2VsZiBpcyB0aGUgdGl0bGUgYW5kIHRoZSB0ZXh0IG9ubHkgYWRkcyB3aGF0IHRoZSB0aXRsZSBkb2Vzbid0XG4vLyBzYXkgLSBvZnRlbiBub3RoaW5nLlxuLy9cbi8vICAgdGl0bGUgICAgICAgLSB0aGUgcXVlc3Rpb24gKFwiRGVsZXRlIFRFUk1JTj9cIik7IGEgc3RyaW5nIG9yIGFuIGFycmF5IG9mXG4vLyAgICAgICAgICAgICAgICAgc3RyaW5ncyBhbmQgbm9kZXMgKGZvciBjb2xvcmVkIG5hbWVzLCBzZWUgYXBwZW5kVHlwTmFtZS9cbi8vICAgICAgICAgICAgICAgICBhcHBlbmRTdWJ0eXBOYW1lKVxuLy8gICBib2R5ICAgICAgICAtIG9wdGlvbmFsIHBhcmFncmFwaHMsIGVhY2ggc2hhcGVkIGxpa2UgdGl0bGVcbi8vICAgY29uZmlybVRleHQgLSBsYWJlbCBvZiB0aGUgYWN0aW9uIGJ1dHRvblxuLy8gICB3YXJuaW5nICAgICAtIGRlc3RydWN0aXZlIGFjdGlvbiAocmVkIGJ1dHRvbilcbi8vICAgZm9jdXMgICAgICAgLSBcImNvbmZpcm1cIiBvciBcImNhbmNlbFwiOiB3aGljaCBidXR0b24gRW50ZXIgdHJpZ2dlcnMuIFJlbmFtZVxuLy8gICAgICAgICAgICAgICAgIGZvY3VzZXMgdGhlIGFjdGlvbiwgZGVsZXRlIGFuZCBtZXJnZSBmb2N1cyBDYW5jZWwuXG4vLyAgIG9uQ29uZmlybSAvIG9uQ2FuY2VsIC0gb25DYW5jZWwgYWxzbyBjb3ZlcnMgRXNjYXBlIGFuZCBhIGNsaWNrIG91dHNpZGUuXG4vLyAgIGRvbnRBc2tBZ2FpbiAtIG9wdGlvbmFsOiBzaG93cyBPYnNpZGlhbidzIFwiRG9uJ3QgYXNrIGFnYWluXCIgY2hlY2tib3ggKGFzXG4vLyAgICAgICAgICAgICAgICAgaW4gaXRzIFwiRGVsZXRlIGZpbGVcIiwgZGVza3RvcCBvbmx5KSBhbmQgcGFzc2VzIGl0cyBzdGF0ZSB0b1xuLy8gICAgICAgICAgICAgICAgIG9uQ29uZmlybShkb250QXNrQWdhaW4pLiBPbmx5IGZvciBkaWFsb2dzIHRoYXQgbWF5IGJlXG4vLyAgICAgICAgICAgICAgICAgc3dpdGNoZWQgb2ZmLCBpLmUuIGFjdGlvbnMgdGhhdCBjYW4gYmUgdW5kb25lLlxuLy9cbi8vIEJvdGggY2FsbGJhY2tzIHJ1biBmcm9tIG9uQ2xvc2UsIGkuZS4gb25jZSB0aGUgZGlhbG9nIGlzIGdvbmUgLSBhcyBiZWZvcmVcbi8vIHRoZSBzd2l0Y2ggdG8gQ29uZmlybWF0aW9uTW9kYWwsIGFuZCBzbyBhIGxvbmcgb25Db25maXJtIChyZXdyaXRpbmcgbWFueVxuLy8gbm90ZXMpIG5laXRoZXIga2VlcHMgdGhlIGRpYWxvZyBvcGVuIG5vciBydW5zIHR3aWNlLlxuY2xhc3MgQ29uZmlybU1vZGFsIGV4dGVuZHMgQ29uZmlybWF0aW9uTW9kYWwge1xuICBjb25zdHJ1Y3RvcihhcHAsIHsgdGl0bGUsIGJvZHkgPSBbXSwgY29uZmlybVRleHQsIHdhcm5pbmcgPSBmYWxzZSwgZm9jdXMgPSBcImNvbmZpcm1cIiwgZG9udEFza0FnYWluID0gZmFsc2UsIG9uQ29uZmlybSwgb25DYW5jZWwgfSkge1xuICAgIHN1cGVyKGFwcCk7XG4gICAgdGhpcy50aXRsZSA9IHRpdGxlO1xuICAgIHRoaXMuYm9keSA9IGJvZHk7XG4gICAgdGhpcy5vbkNvbmZpcm0gPSBvbkNvbmZpcm07XG4gICAgdGhpcy5vbkNhbmNlbCA9IG9uQ2FuY2VsO1xuICAgIHRoaXMuY29uZmlybWVkID0gZmFsc2U7XG4gICAgdGhpcy5kb250QXNrQWdhaW4gPSBmYWxzZTtcblxuICAgIC8vIEJlZm9yZSB0aGUgYnV0dG9ucywgc28gaXQgc2l0cyBvbiB0aGUgbGVmdCBhcyBpbiBPYnNpZGlhbidzIGRpYWxvZ3MuXG4gICAgaWYgKGRvbnRBc2tBZ2FpbiAmJiAhUGxhdGZvcm0uaXNNb2JpbGUpIHtcbiAgICAgIHRoaXMuYWRkQ2hlY2tib3goXCJEb24ndCBhc2sgYWdhaW5cIiwgKGNoZWNrZWQpID0+IHtcbiAgICAgICAgdGhpcy5kb250QXNrQWdhaW4gPSBjaGVja2VkO1xuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gQnV0dG9ucyBhbHJlYWR5IGhlcmUsIG5vdCBpbiBvbk9wZW46IENvbmZpcm1hdGlvbk1vZGFsLm9wZW4oKSBsb29rcyBmb3JcbiAgICAvLyB0aGUgaW5pdGlhbC1mb2N1cyBidXR0b24gYmVmb3JlIGl0IGNhbGxzIG9uT3Blbi5cbiAgICB0aGlzLmFkZEJ1dHRvbigoYnV0dG9uKSA9PiB7XG4gICAgICBidXR0b24uc2V0QnV0dG9uVGV4dChcIkNhbmNlbFwiKS5zZXRDYW5jZWwoKTtcbiAgICAgIGlmIChmb2N1cyA9PT0gXCJjYW5jZWxcIikgYnV0dG9uLnNldEluaXRpYWxGb2N1cygpO1xuICAgIH0pO1xuICAgIHRoaXMuYWRkQnV0dG9uKChidXR0b24pID0+IHtcbiAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KGNvbmZpcm1UZXh0KS5zZXRDdGEoKTtcbiAgICAgIGlmICh3YXJuaW5nKSBidXR0b24uc2V0RGVzdHJ1Y3RpdmUoKTtcbiAgICAgIGlmIChmb2N1cyA9PT0gXCJjb25maXJtXCIpIGJ1dHRvbi5zZXRJbml0aWFsRm9jdXMoKTtcbiAgICAgIC8vIEJyYWNlcywgbm8gcmV0dXJuIHZhbHVlOiBDb25maXJtYXRpb25CdXR0b24ga2VlcHMgdGhlIGRpYWxvZyBvcGVuIGlmXG4gICAgICAvLyB0aGUgaGFuZGxlciByZXR1cm5zIHNvbWV0aGluZyB0cnV0aHksIGFuZCB3YWl0cyBmb3IgYSBwcm9taXNlLlxuICAgICAgYnV0dG9uLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICB0aGlzLmNvbmZpcm1lZCA9IHRydWU7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIG9uT3BlbigpIHtcbiAgICBhcHBlbmRQYXJ0cyh0aGlzLnRpdGxlRWwsIHRoaXMudGl0bGUpO1xuICAgIGZvciAoY29uc3QgcGFyYWdyYXBoIG9mIHRoaXMuYm9keSkgYXBwZW5kUGFydHModGhpcy5jb250ZW50RWwuY3JlYXRlRWwoXCJwXCIpLCBwYXJhZ3JhcGgpO1xuICB9XG5cbiAgb25DbG9zZSgpIHtcbiAgICBzdXBlci5vbkNsb3NlKCk7XG4gICAgdGhpcy5jb250ZW50RWwuZW1wdHkoKTtcbiAgICBpZiAodGhpcy5jb25maXJtZWQpIHRoaXMub25Db25maXJtPy4odGhpcy5kb250QXNrQWdhaW4pO1xuICAgIGVsc2UgdGhpcy5vbkNhbmNlbD8uKCk7XG4gIH1cbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IENvbmZpcm1Nb2RhbCwgYXBwZW5kVHlwTmFtZSwgYXBwZW5kU3VidHlwTmFtZSwgdHlwTmFtZU5vZGUsIHN1YnR5cE5hbWVOb2RlIH07XG4iLCAiY29uc3QgeyBOb3RpY2UgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgZ2V0U3VidHlwIH0gPSByZXF1aXJlKFwiLi9zdWJ0eXBzXCIpO1xuY29uc3QgeyB0eXBLZXlPZiwgcHJvcGVydHlWYWx1ZSwgVFlQX1BST1BFUlRZLCBTVUJUWVBfUFJPUEVSVFkgfSA9IHJlcXVpcmUoXCIuL3R5cC1pbmRleFwiKTtcbmNvbnN0IHsgcGx1cmFsIH0gPSByZXF1aXJlKFwiLi90eXAtdXRpbHNcIik7XG5jb25zdCB7IENvbmZpcm1Nb2RhbCwgdHlwTmFtZU5vZGUgfSA9IHJlcXVpcmUoXCIuL2NvbmZpcm0tbW9kYWxcIik7XG5cbi8vIFRoZSBmb3VyIHBsYWNlaG9sZGVycyBvZiB0aGUgZ2xvYmFsIG9yZGVyOyB0aGUgb3JkZXIgZWRpdG9yIGxldHMgeW91IG1vdmVcbi8vIHRoZW0gYnV0IG5vdCByZW1vdmUgdGhlbS4gXCJ0eXBWYWx1ZVwiIGlzIHRoZSBUWVAgcHJvcGVydHkgaXRzZWxmLFxuLy8gXCJzdWJ0eXBWYWx1ZVwiIHRoZSBTVUJUWVAgcHJvcGVydHksIFwidHlwXCIgdGhlIFRZUC1Gcm9udG1hdHRlciBsaXN0LFxuLy8gXCJvdGhlclwiIGV2ZXJ5dGhpbmcgZWxzZS5cbmNvbnN0IERFRkFVTFRfR0xPQkFMX09SREVSID0gW3sga2luZDogXCJ0eXBWYWx1ZVwiIH0sIHsga2luZDogXCJzdWJ0eXBWYWx1ZVwiIH0sIHsga2luZDogXCJ0eXBcIiB9LCB7IGtpbmQ6IFwib3RoZXJcIiB9XTtcblxuLy8gRW5zdXJlcyBleGFjdGx5IG9uZSBlbnRyeSBwZXIgcGxhY2Vob2xkZXIuIE9sZGVyIHNhdmVkIG9yZGVycyBwcmVkYXRlIHNvbWVcbi8vIG9mIHRoZW07IG1pc3Npbmcgb25lcyBhcmUgYWRkZWQgYXQgYSBzZW5zaWJsZSBzcG90IChcInN1YnR5cFZhbHVlXCIgcmlnaHRcbi8vIGFmdGVyIFwidHlwVmFsdWVcIiwgdGhlIG90aGVycyBhdCB0aGUgZWRnZXMpIHdpdGhvdXQgdG91Y2hpbmcgdGhlIG9yZGVyIHRoZVxuLy8gdXNlciBhcnJhbmdlZC5cbmZ1bmN0aW9uIG5vcm1hbGl6ZUdsb2JhbE9yZGVyKG9yZGVyKSB7XG4gIGNvbnN0IHJlc3VsdCA9IEFycmF5LmlzQXJyYXkob3JkZXIpID8gb3JkZXIuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkgJiYgdHlwZW9mIGVudHJ5ID09PSBcIm9iamVjdFwiKSA6IFtdO1xuICBjb25zdCBoYXNLaW5kID0gKGtpbmQpID0+IHJlc3VsdC5zb21lKChlbnRyeSkgPT4gZW50cnkua2luZCA9PT0ga2luZCk7XG4gIGlmICghaGFzS2luZChcInR5cFZhbHVlXCIpKSByZXN1bHQudW5zaGlmdCh7IGtpbmQ6IFwidHlwVmFsdWVcIiB9KTtcbiAgaWYgKCFoYXNLaW5kKFwic3VidHlwVmFsdWVcIikpIHtcbiAgICBjb25zdCB0eXBWYWx1ZUluZGV4ID0gcmVzdWx0LmZpbmRJbmRleCgoZW50cnkpID0+IGVudHJ5LmtpbmQgPT09IFwidHlwVmFsdWVcIik7XG4gICAgcmVzdWx0LnNwbGljZSh0eXBWYWx1ZUluZGV4ICsgMSwgMCwgeyBraW5kOiBcInN1YnR5cFZhbHVlXCIgfSk7XG4gIH1cbiAgaWYgKCFoYXNLaW5kKFwidHlwXCIpKSByZXN1bHQucHVzaCh7IGtpbmQ6IFwidHlwXCIgfSk7XG4gIGlmICghaGFzS2luZChcIm90aGVyXCIpKSByZXN1bHQucHVzaCh7IGtpbmQ6IFwib3RoZXJcIiB9KTtcbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gKiBGcm9udG1hdHRlciBzb3J0aW5nXG4gKiBQdXRzIHRoZSBwcm9wZXJ0aWVzIGEgbm90ZSBIQVMgaW50byBhIGZpeGVkIG9yZGVyIGJ1aWx0IGZyb21cbiAqIGdsb2JhbFByb3BlcnR5T3JkZXI6IHBpbm5lZCBzaW5nbGUgcHJvcGVydGllcywgdGhlIFRZUCBhbmRcbiAqIFNVQlRZUCBwcm9wZXJ0aWVzLCB0aGUgXCJUWVAtRnJvbnRtYXR0ZXJcIiBibG9jayAodGhlIFRZUCdzIGxpc3RcbiAqIGZvbGxvd2VkIGJ5IGl0cyBTdWJ0eXAgYmxvY2spIGFuZCBcIk90aGVyIHByb3BlcnRpZXNcIi4gTmV2ZXIgYWRkc1xuICogcHJvcGVydGllcyBvciBjaGFuZ2VzIHZhbHVlcy5cbiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqL1xuXG4vLyBLZXkgb3JkZXIgb2YgYSBUWVAncyBmcm9udG1hdHRlciwgZmxvYXRpbmcga2V5cyBpbmNsdWRlZCBhdCB0aGVpciBsaXN0XG4vLyBwb3NpdGlvbiAoZ2V0VHlwRGVmYXVsdHMgbGVhdmVzIHRoZW0gb3V0LCBidXQgYSBub3RlIHRoYXQgaGFzIG9uZSBzaG91bGRcbi8vIHN0aWxsIGdldCBpdCBpbiBwbGFjZSkuIFdpdGhvdXQgVFlQL1NVQlRZUCBhbmQgdGhlIGVkaXRvcidzIGJsYW5rIHJvdy5cbi8vIG51bGwgaWYgdGhlcmUgaXMgbm8gVFlQIG9yIG5vIGxpc3QuXG4vL1xuLy8gV2l0aCBzdWJ0eXAsIHRoZSBrZXlzIG9mIGl0cyBibG9jayBmb2xsb3cuIEEga2V5IGluIEJPVEggYmxvY2tzIGtlZXBzIHRoZVxuLy8gVFlQLUZyb250bWF0dGVyIHBvc2l0aW9uIC0gdGhlIHNhbWUgcnVsZSBhcyBjb2xsZWN0QmxvY2tzIGluIG1haW4uanMsIG9yIGFcbi8vIGZyZXNobHkgY3JlYXRlZCBub3RlIHdvdWxkIGJlIHJlLXNvcnRlZCByaWdodCBhd2F5LlxuZnVuY3Rpb24gb3JkZXJlZERlZmF1bHRLZXlzKHBsdWdpbiwgdHlwLCBzdWJ0eXAgPSBudWxsKSB7XG4gIGlmICghdHlwKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgaXNTeXN0ZW1LZXkgPSAoa2V5KSA9PiBrZXkgPT09IFwiXCIgfHwgW1RZUF9QUk9QRVJUWSwgU1VCVFlQX1BST1BFUlRZXS5zb21lKChwKSA9PiBrZXkudG9Mb3dlckNhc2UoKSA9PT0gcC50b0xvd2VyQ2FzZSgpKTtcbiAgY29uc3Qgc3VidHlwRGF0YSA9IHN1YnR5cCA/IGdldFN1YnR5cChwbHVnaW4uc2V0dGluZ3MsIHR5cCwgc3VidHlwKSA6IG51bGw7XG4gIGNvbnN0IGJsb2NrcyA9IFtwbHVnaW4uc2V0dGluZ3MudHlwRGVmYXVsdEZyb250bWF0dGVyW3R5cF0sIHN1YnR5cERhdGE/LmZyb250bWF0dGVyXTtcbiAgY29uc3Qga2V5cyA9IFtdO1xuICBjb25zdCBzZWVuID0gbmV3IFNldCgpO1xuICBmb3IgKGNvbnN0IGJsb2NrIG9mIGJsb2Nrcykge1xuICAgIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKGJsb2NrID8/IHt9KSkge1xuICAgICAgaWYgKGlzU3lzdGVtS2V5KGtleSkgfHwgc2Vlbi5oYXMoa2V5LnRvTG93ZXJDYXNlKCkpKSBjb250aW51ZTtcbiAgICAgIGtleXMucHVzaChrZXkpO1xuICAgICAgc2Vlbi5hZGQoa2V5LnRvTG93ZXJDYXNlKCkpO1xuICAgIH1cbiAgfVxuICByZXR1cm4ga2V5cy5sZW5ndGggPiAwID8ga2V5cyA6IG51bGw7XG59XG5cbi8vIFRhcmdldCBvcmRlciBvZiBhIG5vdGUncyBleGlzdGluZyBwcm9wZXJ0aWVzLCBmdWxseSBkZWZpbmVkIGJ5IGdsb2JhbE9yZGVyLlxuLy9cbi8vIFdoaWNoIGJsb2NrIGNsYWltcyBhIHByb3BlcnR5IGlzIGRlY2lkZWQgQkVGT1JFIHRoZSBvcmRlciBpcyBidWlsdCAocGlubmVkLFxuLy8gVFlQIGJsb2NrIGFuZCByZXN0IGFyZSBkaXNqb2ludCksIHNvIHRoZSByZXN1bHQgZG9lc24ndCBkZXBlbmQgb24gd2hlcmUgdGhlXG4vLyBibG9ja3Mgc2l0IGluIGdsb2JhbE9yZGVyOiBhIHBpbm5lZCBwcm9wZXJ0eSBuZXZlciBhbHNvIGxhbmRzIGluIHRoZSBUWVBcbi8vIGJsb2NrLCBhbmQgXCJvdGhlclwiIG9ubHkgZXZlciBob2xkcyB0cnVlIGxlZnRvdmVycy5cbmZ1bmN0aW9uIGNvbXB1dGVTb3J0ZWRLZXlzKGV4aXN0aW5nS2V5cywgZ2xvYmFsT3JkZXIsIHR5cERlZmF1bHRLZXlzKSB7XG4gIGNvbnN0IGxvd2VyVG9BY3R1YWwgPSBuZXcgTWFwKGV4aXN0aW5nS2V5cy5tYXAoKGtleSkgPT4gW2tleS50b0xvd2VyQ2FzZSgpLCBrZXldKSk7XG4gIGNvbnN0IHJlc29sdmUgPSAobmFtZSkgPT4gbG93ZXJUb0FjdHVhbC5nZXQobmFtZS50b0xvd2VyQ2FzZSgpKTtcblxuICBjb25zdCBwaW5uZWQgPSBuZXcgU2V0KFxuICAgIGdsb2JhbE9yZGVyXG4gICAgICAuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkua2luZCA9PT0gXCJwcm9wZXJ0eVwiKVxuICAgICAgLm1hcCgoZW50cnkpID0+IHJlc29sdmUoZW50cnkubmFtZSkpXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pXG4gICk7XG4gIGNvbnN0IHR5cEtleSA9IHJlc29sdmUoVFlQX1BST1BFUlRZKTtcbiAgY29uc3Qgc3VidHlwS2V5ID0gcmVzb2x2ZShTVUJUWVBfUFJPUEVSVFkpO1xuICBjb25zdCB0eXBCbG9ja0tleXMgPSBuZXcgU2V0KFxuICAgICh0eXBEZWZhdWx0S2V5cyA/PyBbXSkubWFwKHJlc29sdmUpLmZpbHRlcigoa2V5KSA9PiBrZXkgJiYga2V5ICE9PSB0eXBLZXkgJiYgIXBpbm5lZC5oYXMoa2V5KSlcbiAgKTtcbiAgY29uc3QgY2xhaW1lZCA9IG5ldyBTZXQocGlubmVkKTtcbiAgZm9yIChjb25zdCBrZXkgb2YgdHlwQmxvY2tLZXlzKSBjbGFpbWVkLmFkZChrZXkpO1xuICBpZiAodHlwS2V5KSBjbGFpbWVkLmFkZCh0eXBLZXkpO1xuICBpZiAoc3VidHlwS2V5KSBjbGFpbWVkLmFkZChzdWJ0eXBLZXkpO1xuXG4gIGNvbnN0IHNvcnRlZEtleXMgPSBbXTtcbiAgY29uc3Qgc2VlbiA9IG5ldyBTZXQoKTtcbiAgY29uc3QgcHVzaCA9IChrZXkpID0+IHtcbiAgICBpZiAoa2V5ICYmICFzZWVuLmhhcyhrZXkpKSB7XG4gICAgICBzb3J0ZWRLZXlzLnB1c2goa2V5KTtcbiAgICAgIHNlZW4uYWRkKGtleSk7XG4gICAgfVxuICB9O1xuXG4gIGZvciAoY29uc3QgZW50cnkgb2YgZ2xvYmFsT3JkZXIpIHtcbiAgICBpZiAoZW50cnkua2luZCA9PT0gXCJwcm9wZXJ0eVwiKSBwdXNoKHJlc29sdmUoZW50cnkubmFtZSkpO1xuICAgIGVsc2UgaWYgKGVudHJ5LmtpbmQgPT09IFwidHlwVmFsdWVcIikgcHVzaCh0eXBLZXkpO1xuICAgIGVsc2UgaWYgKGVudHJ5LmtpbmQgPT09IFwic3VidHlwVmFsdWVcIikgcHVzaChzdWJ0eXBLZXkpO1xuICAgIGVsc2UgaWYgKGVudHJ5LmtpbmQgPT09IFwidHlwXCIpIHtcbiAgICAgIGZvciAoY29uc3QgbmFtZSBvZiB0eXBEZWZhdWx0S2V5cyA/PyBbXSkge1xuICAgICAgICBjb25zdCBrZXkgPSByZXNvbHZlKG5hbWUpO1xuICAgICAgICBpZiAoa2V5ICYmIHR5cEJsb2NrS2V5cy5oYXMoa2V5KSkgcHVzaChrZXkpO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoZW50cnkua2luZCA9PT0gXCJvdGhlclwiKSB7XG4gICAgICBmb3IgKGNvbnN0IGtleSBvZiBleGlzdGluZ0tleXMpIHtcbiAgICAgICAgaWYgKCFjbGFpbWVkLmhhcyhrZXkpKSBwdXNoKGtleSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gU2FmZXR5IG5ldCBmb3IgYW4gaW5jb21wbGV0ZSBnbG9iYWxPcmRlciAoY29ycnVwdCBzZXR0aW5ncykuXG4gIGZvciAoY29uc3Qga2V5IG9mIGV4aXN0aW5nS2V5cykgcHVzaChrZXkpO1xuICByZXR1cm4gc29ydGVkS2V5cztcbn1cblxuLy8gXCJwb3NpdGlvblwiIGlzIE9ic2lkaWFuJ3MgbG9jYXRpb24gb2YgdGhlIGZyb250bWF0dGVyIGJsb2NrLCBwcmVzZW50IG9ubHkgaW5cbi8vIHRoZSBjYWNoZSBvYmplY3QsIG5vdCBhIHByb3BlcnR5LlxuZnVuY3Rpb24gY2FjaGVkRnJvbnRtYXR0ZXJLZXlzKGFwcCwgZmlsZSkge1xuICBjb25zdCBmcm9udG1hdHRlciA9IGFwcC5tZXRhZGF0YUNhY2hlLmdldEZpbGVDYWNoZShmaWxlKT8uZnJvbnRtYXR0ZXI7XG4gIGlmICghZnJvbnRtYXR0ZXIpIHJldHVybiBudWxsO1xuICByZXR1cm4gT2JqZWN0LmtleXMoZnJvbnRtYXR0ZXIpLmZpbHRlcigoa2V5KSA9PiBrZXkgIT09IFwicG9zaXRpb25cIik7XG59XG5cbi8vIENoZWFwIHByZS1jaGVjayBhZ2FpbnN0IHRoZSBpbi1tZW1vcnkgY2FjaGU6IG1vc3Qgbm90ZXMgYXJlIGFscmVhZHkgc29ydGVkLFxuLy8gYW5kIHRoaXMgc2tpcHMgb3BlbmluZyB0aGVtIGF0IGFsbCAtIHRoYXQgaXMgd2hlcmUgcmVwZWF0ZWQgdmF1bHQgcnVucyBnZXRcbi8vIHRoZWlyIHNwZWVkLiBBbHNvIHdoYXQgdGhlIHBsYXkgYnV0dG9uIGNvdW50cyB3aXRoIGJlZm9yZSBpdCBhc2tzLlxuZnVuY3Rpb24gY2FjaGVOZWVkc1NvcnRpbmcoYXBwLCBmaWxlLCBnbG9iYWxPcmRlciwgdHlwRGVmYXVsdEtleXMpIHtcbiAgY29uc3QgY2FjaGVkS2V5cyA9IGNhY2hlZEZyb250bWF0dGVyS2V5cyhhcHAsIGZpbGUpO1xuICBpZiAoIWNhY2hlZEtleXMgfHwgY2FjaGVkS2V5cy5sZW5ndGggPD0gMSkgcmV0dXJuIGZhbHNlO1xuICBjb25zdCBjYWNoZWRTb3J0ZWQgPSBjb21wdXRlU29ydGVkS2V5cyhjYWNoZWRLZXlzLCBnbG9iYWxPcmRlciwgdHlwRGVmYXVsdEtleXMpO1xuICByZXR1cm4gIWNhY2hlZFNvcnRlZC5ldmVyeSgoa2V5LCBpKSA9PiBrZXkgPT09IGNhY2hlZEtleXNbaV0pO1xufVxuXG5hc3luYyBmdW5jdGlvbiBzb3J0RmlsZUZyb250bWF0dGVyKGFwcCwgZmlsZSwgZ2xvYmFsT3JkZXIsIHR5cERlZmF1bHRLZXlzKSB7XG4gIC8vIHByb2Nlc3NGcm9udE1hdHRlciBzdGF5cyB0aGUgc291cmNlIG9mIHRydXRoIGZvciB0aGUgYWN0dWFsIHdyaXRlLCBzaW5jZVxuICAvLyB0aGUgY2FjaGUgY2FuIGxhZyBiZWhpbmQuXG4gIGlmICghY2FjaGVOZWVkc1NvcnRpbmcoYXBwLCBmaWxlLCBnbG9iYWxPcmRlciwgdHlwRGVmYXVsdEtleXMpKSByZXR1cm4gZmFsc2U7XG5cbiAgbGV0IGNoYW5nZWQgPSBmYWxzZTtcbiAgYXdhaXQgYXBwLmZpbGVNYW5hZ2VyLnByb2Nlc3NGcm9udE1hdHRlcihmaWxlLCAoZnJvbnRtYXR0ZXIpID0+IHtcbiAgICBjaGFuZ2VkID0gc29ydEZyb250bWF0dGVyT2JqZWN0KGZyb250bWF0dGVyLCBnbG9iYWxPcmRlciwgdHlwRGVmYXVsdEtleXMpO1xuICB9KTtcbiAgcmV0dXJuIGNoYW5nZWQ7XG59XG5cbi8vIFNvcnRzIHRoZSBwcm9jZXNzRnJvbnRNYXR0ZXIgb2JqZWN0IGluIHBsYWNlOiBpbnNlcnRpb24gb3JkZXIgYmVjb21lcyB0aGVcbi8vIFlBTUwgb3JkZXIsIHNvIGFsbCBrZXlzIGFyZSBkZWxldGVkIGFuZCByZS1hZGRlZC4gUmV0dXJucyB0cnVlIG9uIGEgY2hhbmdlLlxuZnVuY3Rpb24gc29ydEZyb250bWF0dGVyT2JqZWN0KGZyb250bWF0dGVyLCBnbG9iYWxPcmRlciwgdHlwRGVmYXVsdEtleXMpIHtcbiAgY29uc3QgZXhpc3RpbmdLZXlzID0gT2JqZWN0LmtleXMoZnJvbnRtYXR0ZXIpO1xuICBpZiAoZXhpc3RpbmdLZXlzLmxlbmd0aCA8PSAxKSByZXR1cm4gZmFsc2U7XG5cbiAgY29uc3Qgc29ydGVkS2V5cyA9IGNvbXB1dGVTb3J0ZWRLZXlzKGV4aXN0aW5nS2V5cywgZ2xvYmFsT3JkZXIsIHR5cERlZmF1bHRLZXlzKTtcbiAgaWYgKHNvcnRlZEtleXMuZXZlcnkoKGtleSwgaSkgPT4ga2V5ID09PSBleGlzdGluZ0tleXNbaV0pKSByZXR1cm4gZmFsc2U7XG5cbiAgY29uc3Qgc25hcHNob3QgPSB7IC4uLmZyb250bWF0dGVyIH07XG4gIGZvciAoY29uc3Qga2V5IG9mIGV4aXN0aW5nS2V5cykgZGVsZXRlIGZyb250bWF0dGVyW2tleV07XG4gIGZvciAoY29uc3Qga2V5IG9mIHNvcnRlZEtleXMpIGZyb250bWF0dGVyW2tleV0gPSBzbmFwc2hvdFtrZXldO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuLy8gRm9yIGNhbGxlcnMgYWxyZWFkeSBpbnNpZGUgcHJvY2Vzc0Zyb250TWF0dGVyIChUWVAuanMpOiBUWVAgYW5kIFN1YnR5cCBhcmVcbi8vIHBhc3NlZCBleHBsaWNpdGx5LCBiZWNhdXNlIGluZGV4IGFuZCBjYWNoZSBkb24ndCBrbm93IHRoZSB2YWx1ZXMganVzdFxuLy8gd3JpdHRlbiB5ZXQuXG5mdW5jdGlvbiBzb3J0RnJvbnRtYXR0ZXJGb3IocGx1Z2luLCBmcm9udG1hdHRlciwgdHlwLCBzdWJ0eXApIHtcbiAgY29uc3QgZ2xvYmFsT3JkZXIgPSBub3JtYWxpemVHbG9iYWxPcmRlcihwbHVnaW4uc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlcik7XG4gIHJldHVybiBzb3J0RnJvbnRtYXR0ZXJPYmplY3QoZnJvbnRtYXR0ZXIsIGdsb2JhbE9yZGVyLCBvcmRlcmVkRGVmYXVsdEtleXMocGx1Z2luLCB0eXAsIHN1YnR5cCkpO1xufVxuXG4vLyBNb3ZlcyBvbmx5IGBrZXlgIHRvIGl0cyBzb3J0ZWQgcGxhY2UgYW5kIGxlYXZlcyBldmVyeSBvdGhlciBrZXkgd2hlcmUgaXQgaXNcbi8vIC0gZm9yIGNhbGxlcnMgdGhhdCBqdXN0IGFkZGVkIGEgcHJvcGVydHkgKEZyZWQncyBwcm9wZXJ0eSBiYWNrbGlua2luZykgYW5kXG4vLyBzaG91bGRuJ3QgcmVzaHVmZmxlIGEgZGVsaWJlcmF0ZWx5IGRpZmZlcmVudCBvcmRlci4gVFlQL1NVQlRZUCBhcmUgcmVhZCBmcm9tXG4vLyB0aGUgb2JqZWN0IGl0c2VsZjsgaW5kZXggYW5kIGNhY2hlIG1heSBzdGlsbCBiZSBiZWhpbmQuXG4vL1xuLy8gVGhlIHBsYWNlIGlzIHJpZ2h0IGFmdGVyIGtleSdzIG5lYXJlc3QgcHJlZGVjZXNzb3IgaW4gdGhlIGZ1bGx5IHNvcnRlZFxuLy8gb3JkZXIgKGZpcnN0IGlmIHRoZXJlIGlzIG5vbmUpLiBSZXR1cm5zIHRydWUgb24gYSBjaGFuZ2UuXG5mdW5jdGlvbiBwbGFjZVByb3BlcnR5Rm9yKHBsdWdpbiwgZnJvbnRtYXR0ZXIsIGtleSkge1xuICBjb25zdCBleGlzdGluZ0tleXMgPSBPYmplY3Qua2V5cyhmcm9udG1hdHRlcik7XG4gIGNvbnN0IGFjdHVhbEtleSA9IGV4aXN0aW5nS2V5cy5maW5kKChrKSA9PiBrLnRvTG93ZXJDYXNlKCkgPT09IGtleS50b0xvd2VyQ2FzZSgpKTtcbiAgaWYgKCFhY3R1YWxLZXkgfHwgZXhpc3RpbmdLZXlzLmxlbmd0aCA8PSAxKSByZXR1cm4gZmFsc2U7XG5cbiAgY29uc3QgZ2xvYmFsT3JkZXIgPSBub3JtYWxpemVHbG9iYWxPcmRlcihwbHVnaW4uc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlcik7XG4gIGNvbnN0IHR5cCA9IHR5cEtleU9mKHByb3BlcnR5VmFsdWUoZnJvbnRtYXR0ZXIsIFRZUF9QUk9QRVJUWSkpO1xuICBjb25zdCBzdWJ0eXAgPSB0eXBLZXlPZihwcm9wZXJ0eVZhbHVlKGZyb250bWF0dGVyLCBTVUJUWVBfUFJPUEVSVFkpKTtcbiAgY29uc3Qgc29ydGVkS2V5cyA9IGNvbXB1dGVTb3J0ZWRLZXlzKGV4aXN0aW5nS2V5cywgZ2xvYmFsT3JkZXIsIG9yZGVyZWREZWZhdWx0S2V5cyhwbHVnaW4sIHR5cCwgc3VidHlwKSk7XG5cbiAgY29uc3QgcmVzdCA9IGV4aXN0aW5nS2V5cy5maWx0ZXIoKGspID0+IGsgIT09IGFjdHVhbEtleSk7XG4gIGNvbnN0IHByZWRlY2Vzc29yID0gc29ydGVkS2V5cy5zbGljZSgwLCBzb3J0ZWRLZXlzLmluZGV4T2YoYWN0dWFsS2V5KSkucG9wKCk7XG4gIGNvbnN0IG5ld0tleXMgPSBbLi4ucmVzdF07XG4gIG5ld0tleXMuc3BsaWNlKHByZWRlY2Vzc29yID09PSB1bmRlZmluZWQgPyAwIDogcmVzdC5pbmRleE9mKHByZWRlY2Vzc29yKSArIDEsIDAsIGFjdHVhbEtleSk7XG4gIGlmIChuZXdLZXlzLmV2ZXJ5KChrLCBpKSA9PiBrID09PSBleGlzdGluZ0tleXNbaV0pKSByZXR1cm4gZmFsc2U7XG5cbiAgY29uc3Qgc25hcHNob3QgPSB7IC4uLmZyb250bWF0dGVyIH07XG4gIGZvciAoY29uc3QgayBvZiBleGlzdGluZ0tleXMpIGRlbGV0ZSBmcm9udG1hdHRlcltrXTtcbiAgZm9yIChjb25zdCBrIG9mIG5ld0tleXMpIGZyb250bWF0dGVyW2tdID0gc25hcHNob3Rba107XG4gIHJldHVybiB0cnVlO1xufVxuXG5hc3luYyBmdW5jdGlvbiBzb3J0U2luZ2xlRmlsZUZyb250bWF0dGVyKGFwcCwgcGx1Z2luLCBmaWxlKSB7XG4gIGNvbnN0IGdsb2JhbE9yZGVyID0gbm9ybWFsaXplR2xvYmFsT3JkZXIocGx1Z2luLnNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXIpO1xuICAvLyBBbiB1bmNsZWFuIFRZUCB2YWx1ZSAobGlzdCwgcGFkZGVkKSBoYXMgbm8gVFlQLUZyb250bWF0dGVyOyBvbmx5IHRoZSBnbG9iYWxcbiAgLy8gb3JkZXIgYXBwbGllcyB0aGVuIChzZWUgdHlwS2V5T2YgaW4gdHlwLWluZGV4LmpzKS5cbiAgY29uc3QgdHlwID0gcGx1Z2luLnR5cEluZGV4LnR5cE9mKGZpbGUpO1xuICBjb25zdCB0eXBEZWZhdWx0S2V5cyA9IG9yZGVyZWREZWZhdWx0S2V5cyhwbHVnaW4sIHR5cCwgcGx1Z2luLnR5cEluZGV4LnN1YnR5cE9mKGZpbGUpKTtcbiAgcmV0dXJuIHNvcnRGaWxlRnJvbnRtYXR0ZXIoYXBwLCBmaWxlLCBnbG9iYWxPcmRlciwgdHlwRGVmYXVsdEtleXMpO1xufVxuXG4vLyBGcm9tIHRoaXMgbWFueSBub3RlcyB0byByZS1zb3J0IG9uLCBhIHJ1biBpcyBcImxhcmdlXCI6IGl0IGFza3MgZmlyc3QgKHNlZVxuLy8gcnVuRnJvbnRtYXR0ZXJTb3J0KSBhbmQgc2hvd3MgaXRzIHByb2dyZXNzIGluIGEgbm90aWNlLCB1cGRhdGVkIGV2ZXJ5XG4vLyBQUk9HUkVTU19TVEVQIG5vdGVzLiBPbmUgbnVtYmVyIGZvciBib3RoLCBzbyBhIHJ1biB0aGF0IGFza2VkIGFsc28gc2hvd3Ncbi8vIGhvdyBmYXIgaXQgZ290LCBhbmQgYSBzbWFsbCBvbmUgZG9lcyBuZWl0aGVyLlxuY29uc3QgTEFSR0VfU09SVF9USFJFU0hPTEQgPSA1MDtcbmNvbnN0IFBST0dSRVNTX1NURVAgPSAxMDtcblxuLy8gRmlyc3QgaGFsZiBvZiBhIHJ1biwgZnJvbSB0aGUgbWV0YWRhdGEgY2FjaGUgYWxvbmUgKG5vIG5vdGUgaXMgb3BlbmVkKTogaG93XG4vLyBtYW55IG5vdGVzIHRoZSBydW4gY2hlY2tzIGFuZCB3aGljaCBvZiB0aGVtIGl0IHdvdWxkIHJlLXNvcnQuXG4vLyBydW5Gcm9udG1hdHRlclNvcnQgY291bnRzIHdpdGggaXQgYmVmb3JlIGFza2luZzsgc29ydEFsbEZyb250bWF0dGVyIHdyaXRlc1xuLy8gZXhhY3RseSB0aGVzZSBjYW5kaWRhdGVzLlxuLy9cbi8vIG9ubHlUeXAgKG9wdGlvbmFsKSBsaW1pdHMgdGhlIHJ1biB0byBub3RlcyBvZiB0aGF0IFRZUC4gV2l0aG91dCBpdCBldmVyeVxuLy8gbm90ZSBpcyBjaGVja2VkLCBpbmNsdWRpbmcgbm90ZXMgd2l0aG91dCBhIFRZUDogcGlubmVkIHByb3BlcnRpZXMgc3VjaCBhc1xuLy8gY3NzY2xhc3NlcyBhcHBseSByZWdhcmRsZXNzIG9mIFRZUC5cbmZ1bmN0aW9uIHNvcnRDYW5kaWRhdGVzKGFwcCwgcGx1Z2luLCBvbmx5VHlwKSB7XG4gIGNvbnN0IGdsb2JhbE9yZGVyID0gbm9ybWFsaXplR2xvYmFsT3JkZXIocGx1Z2luLnNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXIpO1xuICBsZXQgY2hlY2tlZCA9IDA7XG4gIGNvbnN0IGNhbmRpZGF0ZXMgPSBbXTtcblxuICBmb3IgKGNvbnN0IGZpbGUgb2YgYXBwLnZhdWx0LmdldE1hcmtkb3duRmlsZXMoKSkge1xuICAgIGlmICghcGx1Z2luLnNldHRpbmdzLmluY2x1ZGVJZ25vcmVkRmlsZXMgJiYgYXBwLm1ldGFkYXRhQ2FjaGUuaXNVc2VySWdub3JlZChmaWxlLnBhdGgpKSBjb250aW51ZTtcblxuICAgIGNvbnN0IHR5cCA9IHBsdWdpbi50eXBJbmRleC50eXBPZihmaWxlKTtcbiAgICBpZiAob25seVR5cCAmJiB0eXAgIT09IG9ubHlUeXApIGNvbnRpbnVlO1xuXG4gICAgY29uc3QgdHlwRGVmYXVsdEtleXMgPSBvcmRlcmVkRGVmYXVsdEtleXMocGx1Z2luLCB0eXAsIHBsdWdpbi50eXBJbmRleC5zdWJ0eXBPZihmaWxlKSk7XG4gICAgY2hlY2tlZCsrO1xuICAgIGlmIChjYWNoZU5lZWRzU29ydGluZyhhcHAsIGZpbGUsIGdsb2JhbE9yZGVyLCB0eXBEZWZhdWx0S2V5cykpIGNhbmRpZGF0ZXMucHVzaCh7IGZpbGUsIHR5cERlZmF1bHRLZXlzIH0pO1xuICB9XG5cbiAgcmV0dXJuIHsgY2hlY2tlZCwgY2FuZGlkYXRlcywgZ2xvYmFsT3JkZXIgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gc29ydEFsbEZyb250bWF0dGVyKGFwcCwgcGx1Z2luLCBvbmx5VHlwKSB7XG4gIC8vIENvdW50ZWQgYWZyZXNoLCBub3QgdGFrZW4gb3ZlciBmcm9tIHJ1bkZyb250bWF0dGVyU29ydCdzIHF1ZXN0aW9uOiB0aGVcbiAgLy8gZGlhbG9nIG1heSBoYXZlIGJlZW4gb3BlbiBmb3IgYSB3aGlsZS5cbiAgY29uc3QgeyBjaGVja2VkLCBjYW5kaWRhdGVzLCBnbG9iYWxPcmRlciB9ID0gc29ydENhbmRpZGF0ZXMoYXBwLCBwbHVnaW4sIG9ubHlUeXApO1xuICAvLyBPbmx5IG1lYW5pbmdmdWwgZm9yIGEgc2luZ2xlIFRZUDogbGV0cyB0aGUgY29tbWFuZCBleHBsYWluIGEgcnVuIHRoYXRcbiAgLy8gY2hhbmdlZCBub3RoaW5nIGJlY2F1c2UgdGhlIFRZUCBoYXMgbm8gVFlQLUZyb250bWF0dGVyLlxuICBjb25zdCBoYXNUeXBEZWZhdWx0cyA9IG9ubHlUeXAgPyBvcmRlcmVkRGVmYXVsdEtleXMocGx1Z2luLCBvbmx5VHlwKSAhPT0gbnVsbCA6IG51bGw7XG5cbiAgY29uc3QgbGFiZWwgPSBvbmx5VHlwID8gYEZyb250bWF0dGVyIHNvcnRpbmcgJHtvbmx5VHlwfWAgOiBcIkZyb250bWF0dGVyIHNvcnRpbmdcIjtcbiAgY29uc3QgcHJvZ3Jlc3NUZXh0ID0gKGRvbmUpID0+IGAke2xhYmVsfTogJHtkb25lfSBvZiAke3BsdXJhbChjYW5kaWRhdGVzLmxlbmd0aCwgXCJub3RlXCIpfVx1MjAyNmA7XG4gIC8vIER1cmF0aW9uIDA6IHN0YXlzIHVudGlsIGhpZGRlbiBiZWxvdywgYSB0aW1lZCBvbmUgY291bGQgdmFuaXNoIG1pZC1ydW4uXG4gIGNvbnN0IG5vdGljZSA9IGNhbmRpZGF0ZXMubGVuZ3RoID49IExBUkdFX1NPUlRfVEhSRVNIT0xEID8gbmV3IE5vdGljZShwcm9ncmVzc1RleHQoMCksIDApIDogbnVsbDtcblxuICBsZXQgY2hhbmdlZCA9IDA7XG4gIHRyeSB7XG4gICAgZm9yIChjb25zdCBbaW5kZXgsIHsgZmlsZSwgdHlwRGVmYXVsdEtleXMgfV0gb2YgY2FuZGlkYXRlcy5lbnRyaWVzKCkpIHtcbiAgICAgIC8vIHNvcnRGaWxlRnJvbnRtYXR0ZXIgY2hlY2tzIHRoZSBjYWNoZSBvbmNlIG1vcmUgLSBhIG5vdGUgbWF5IGhhdmUgYmVlblxuICAgICAgLy8gc29ydGVkIG9yIGVkaXRlZCBzaW5jZSB0aGUgY291bnQuXG4gICAgICBpZiAoYXdhaXQgc29ydEZpbGVGcm9udG1hdHRlcihhcHAsIGZpbGUsIGdsb2JhbE9yZGVyLCB0eXBEZWZhdWx0S2V5cykpIGNoYW5nZWQrKztcbiAgICAgIGlmIChub3RpY2UgJiYgKGluZGV4ICsgMSkgJSBQUk9HUkVTU19TVEVQID09PSAwKSBub3RpY2Uuc2V0TWVzc2FnZShwcm9ncmVzc1RleHQoaW5kZXggKyAxKSk7XG4gICAgfVxuICB9IGZpbmFsbHkge1xuICAgIG5vdGljZT8uaGlkZSgpO1xuICB9XG5cbiAgcmV0dXJuIHsgY2hlY2tlZCwgY2hhbmdlZCwgaGFzVHlwRGVmYXVsdHMgfTtcbn1cblxuLy8gUmVzb2x2ZXMgdHJ1ZSBmb3IgXCJTb3J0XCIsIGZhbHNlIGZvciBDYW5jZWwsIEVzY2FwZSBvciBhIGNsaWNrIG91dHNpZGUuXG5mdW5jdGlvbiBjb25maXJtTGFyZ2VTb3J0KHBsdWdpbiwgb25seVR5cCwgY291bnQsIGNoZWNrZWQpIHtcbiAgY29uc3Qgbm91biA9IGNoZWNrZWQgPT09IDEgPyBcIm5vdGVcIiA6IFwibm90ZXNcIjtcbiAgY29uc3QgdGl0bGUgPSBvbmx5VHlwXG4gICAgPyBbYFJlLXNvcnQgJHtjb3VudH0gb2YgJHtjaGVja2VkfSBgLCB0eXBOYW1lTm9kZShwbHVnaW4sIG9ubHlUeXAsIHBsdWdpbi5zZXR0aW5ncy50eXBDb2xvcnNbb25seVR5cF0gPz8gbnVsbCksIGAgJHtub3VufT9gXVxuICAgIDogYFJlLXNvcnQgJHtjb3VudH0gb2YgJHtjaGVja2VkfSAke25vdW59P2A7XG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT5cbiAgICBuZXcgQ29uZmlybU1vZGFsKHBsdWdpbi5hcHAsIHtcbiAgICAgIHRpdGxlLFxuICAgICAgYm9keTogW1wiT25seSB0aGUgb3JkZXIgb2YgdGhlaXIgcHJvcGVydGllcyBjaGFuZ2VzLCB2YWx1ZXMgc3RheSBhcyB0aGV5IGFyZS5cIl0sXG4gICAgICBjb25maXJtVGV4dDogXCJTb3J0XCIsXG4gICAgICAvLyBMaWtlIFwiUmVuYW1lIGFuZCB1cGRhdGUgbm90ZXNcIjogRW50ZXIgY29uZmlybXMgdGhlIHJ1biBqdXN0IGFza2VkIGZvci5cbiAgICAgIGZvY3VzOiBcImNvbmZpcm1cIixcbiAgICAgIG9uQ29uZmlybTogKCkgPT4gcmVzb2x2ZSh0cnVlKSxcbiAgICAgIG9uQ2FuY2VsOiAoKSA9PiByZXNvbHZlKGZhbHNlKSxcbiAgICB9KS5vcGVuKClcbiAgKTtcbn1cblxuLy8gVGhlIG9uZSBlbnRyeSBwb2ludCBvZiBldmVyeSBzb3J0aW5nIHJ1biBvdmVyIG1hbnkgbm90ZXM6IHRoZSBjb21tYW5kcyBcIlNvcnRcbi8vIGZyb250bWF0dGVyIGluIGFsbCBub3Rlc1wiIGFuZCBcIlNvcnQgZnJvbnRtYXR0ZXIgZm9yIG9uZSBUWVBcIiAoYWZ0ZXIgaXRzXG4vLyBwaWNrZXIpLCB0aGUgcGxheSBidXR0b24gb2YgdGhlIGdsb2JhbCBvcmRlciBhbmQgdGhlIFRZUC1QYW5lJ3MgY29udGV4dFxuLy8gbWVudS4gb25seVR5cCBudWxsID0gYWxsIG5vdGVzLlxuLy9cbi8vIEEgbGFyZ2UgcnVuIChMQVJHRV9TT1JUX1RIUkVTSE9MRCBub3RlcyB0byByZS1zb3J0LCBjb3VudGVkIGZyb20gdGhlIGNhY2hlKVxuLy8gYXNrcyBmaXJzdDsgdGhlIHF1ZXN0aW9uIGNhbid0IGJlIHN3aXRjaGVkIG9mZiwgdGhlIHJ1biByZXdyaXRlcyBub3RlcyBhbmRcbi8vIGhhcyBubyB1bmRvLiBBIHNtYWxsIG9uZSBqdXN0IHJ1bnMuIEVpdGhlciB3YXkgYSBub3RpY2UgcmVwb3J0cyB0aGUgcmVzdWx0LlxuYXN5bmMgZnVuY3Rpb24gcnVuRnJvbnRtYXR0ZXJTb3J0KHBsdWdpbiwgb25seVR5cCA9IG51bGwpIHtcbiAgY29uc3QgeyBjaGVja2VkLCBjYW5kaWRhdGVzIH0gPSBzb3J0Q2FuZGlkYXRlcyhwbHVnaW4uYXBwLCBwbHVnaW4sIG9ubHlUeXApO1xuICBpZiAoY2FuZGlkYXRlcy5sZW5ndGggPj0gTEFSR0VfU09SVF9USFJFU0hPTEQgJiYgIShhd2FpdCBjb25maXJtTGFyZ2VTb3J0KHBsdWdpbiwgb25seVR5cCwgY2FuZGlkYXRlcy5sZW5ndGgsIGNoZWNrZWQpKSkgcmV0dXJuO1xuXG4gIGNvbnN0IHsgY2hhbmdlZCwgaGFzVHlwRGVmYXVsdHMsIGNoZWNrZWQ6IGNoZWNrZWROb3cgfSA9IGF3YWl0IHNvcnRBbGxGcm9udG1hdHRlcihwbHVnaW4uYXBwLCBwbHVnaW4sIG9ubHlUeXApO1xuICBsZXQgbWVzc2FnZSA9IHNvcnRTdW1tYXJ5KG9ubHlUeXAgPyBgRnJvbnRtYXR0ZXIgc29ydGluZyAke29ubHlUeXB9YCA6IFwiRnJvbnRtYXR0ZXIgc29ydGluZ1wiLCBjaGVja2VkTm93LCBjaGFuZ2VkKTtcbiAgLy8gTm90IGFuIGVycm9yLCBidXQgZXhwbGFpbnMgd2h5IG5vdGhpbmcgbWF5IGhhdmUgY2hhbmdlZC5cbiAgaWYgKGhhc1R5cERlZmF1bHRzID09PSBmYWxzZSkge1xuICAgIG1lc3NhZ2UgKz0gYCBOb3RlOiAke29ubHlUeXB9IGhhcyBubyBUWVAtRnJvbnRtYXR0ZXIsIHNvIG9ubHkgdGhlIGdsb2JhbCBvcmRlciB3YXMgYXBwbGllZC5gO1xuICB9XG4gIG5ldyBOb3RpY2UobWVzc2FnZSk7XG59XG5cbi8vIFJlc3VsdCBub3RpY2Ugb2YgYSBzb3J0aW5nIHJ1biBvdmVyIG1hbnkgbm90ZXMgKHJ1bkZyb250bWF0dGVyU29ydCkuXG5mdW5jdGlvbiBzb3J0U3VtbWFyeShsYWJlbCwgY2hlY2tlZCwgY2hhbmdlZCkge1xuICByZXR1cm4gY2hhbmdlZCA+IDBcbiAgICA/IGAke2xhYmVsfTogY2hlY2tlZCAke3BsdXJhbChjaGVja2VkLCBcIm5vdGVcIil9LCBzb3J0ZWQgJHtjaGFuZ2VkfS5gXG4gICAgOiBgJHtsYWJlbH06IGNoZWNrZWQgJHtwbHVyYWwoY2hlY2tlZCwgXCJub3RlXCIpfSwgYWxsIGFscmVhZHkgc29ydGVkLmA7XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICBzb3J0U2luZ2xlRmlsZUZyb250bWF0dGVyLFxuICBydW5Gcm9udG1hdHRlclNvcnQsXG4gIHNvcnRGcm9udG1hdHRlckZvcixcbiAgcGxhY2VQcm9wZXJ0eUZvcixcbiAgbm9ybWFsaXplR2xvYmFsT3JkZXIsXG4gIERFRkFVTFRfR0xPQkFMX09SREVSLFxuICBUWVBfUFJPUEVSVFksXG4gIFNVQlRZUF9QUk9QRVJUWSxcbn07XG4iLCAiY29uc3QgeyBzZXRJY29uLCBOb3RpY2UgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgVFlQX1BST1BFUlRZLCBTVUJUWVBfUFJPUEVSVFksIHJ1bkZyb250bWF0dGVyU29ydCB9ID0gcmVxdWlyZShcIi4vZnJvbnRtYXR0ZXItc29ydFwiKTtcblxuLy8gTGFiZWxzIG9mIHRoZSBmb3VyIHBsYWNlaG9sZGVyIHJvd3M7IGNvbXB1dGVTb3J0ZWRLZXlzIGluIGZyb250bWF0dGVyLXNvcnQuanNcbi8vIHJlc29sdmVzIHdoYXQgZWFjaCBvbmUgc3RhbmRzIGZvci5cbmNvbnN0IFBMQUNFSE9MREVSX0xBQkVMUyA9IHtcbiAgdHlwVmFsdWU6IFwiVFlQXCIsXG4gIHN1YnR5cFZhbHVlOiBcIlNVQlRZUFwiLFxuICB0eXA6IFwiVFlQLUZyb250bWF0dGVyXCIsXG4gIG90aGVyOiBcIk90aGVyIHByb3BlcnRpZXNcIixcbn07XG5cbi8vIFdoYXQgZWFjaCBwbGFjZWhvbGRlciByb3cgc3RhbmRzIGZvciwgYXMgaXRzIHRvb2x0aXAgLSB0aGUgc2V0dGluZydzXG4vLyBkZXNjcmlwdGlvbiBiZWxvdyB0aGUgbGlzdCBzdGF5cyBzaG9ydCB0aGF0IHdheS5cbmNvbnN0IFBMQUNFSE9MREVSX0RFU0NSSVBUSU9OUyA9IHtcbiAgdHlwVmFsdWU6IFwiVGhlIFRZUCBwcm9wZXJ0eSBpdHNlbGYuXCIsXG4gIHN1YnR5cFZhbHVlOiBcIlRoZSBTVUJUWVAgcHJvcGVydHkgaXRzZWxmLlwiLFxuICB0eXA6IFwiVGhlIFRZUCdzIFRZUC1Gcm9udG1hdHRlciBsaXN0LCBmb2xsb3dlZCBieSB0aGUgbm90ZSdzIFN1YnR5cCBibG9jay5cIixcbiAgb3RoZXI6IFwiRXZlcnkgcHJvcGVydHkgbm90IHBsYWNlZCBieSBhbm90aGVyIHJvdy5cIixcbn07XG5cbi8vIEVkaXRvciBmb3Igc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlcjogYSBwbGFpbiBsaXN0IG9mIG5hbWVzIHdpdGggZHJhZyAmXG4vLyBkcm9wLiBJdCBob2xkcyBubyB2YWx1ZXMsIHNvIHVubGlrZSB0eXAtZnJvbnRtYXR0ZXItZWRpdG9yLmpzIGl0IG5lZWRzIG5vXG4vLyBkZXRvdXIgdGhyb3VnaCBPYnNpZGlhbidzIHByaXZhdGUgcHJvcGVydHkgd2lkZ2V0LiBUaGUgcGxhY2Vob2xkZXIgcm93cyBjYW5cbi8vIGJlIG1vdmVkIGJ1dCBub3QgcmVtb3ZlZC5cbmZ1bmN0aW9uIG1vdW50R2xvYmFsT3JkZXJFZGl0b3IoY29udGFpbmVyRWwsIHBsdWdpbikge1xuICBjb25zdCBoZWFkZXIgPSBjb250YWluZXJFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWZyb250bWF0dGVyLWhlYWRlclwiIH0pO1xuXG4gIC8vIEJ1dHRvbiBhbmQgdGl0bGUgc2hhcmUgYSBncm91cDogdGhlIGhlYWRlciB1c2VzIHNwYWNlLWJldHdlZW4sIHNvIGEgdGhpcmRcbiAgLy8gZGlyZWN0IGNoaWxkIHdvdWxkIGZsb2F0IGluIHRoZSBtaWRkbGUgaW5zdGVhZCBvZiBuZXh0IHRvIHRoZSB0aXRsZS5cbiAgY29uc3QgdGl0bGVHcm91cCA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWZyb250bWF0dGVyLXRpdGxlLWdyb3VwXCIgfSk7XG5cbiAgLy8gU2FtZSBydW4gYXMgdGhlIFwiU29ydCBmcm9udG1hdHRlciBpbiBhbGwgbm90ZXNcIiBjb21tYW5kLCBpbmNsdWRpbmcgaXRzXG4gIC8vIHF1ZXN0aW9uIGJlZm9yZSBhIGxhcmdlIHJ1biAoc2VlIHJ1bkZyb250bWF0dGVyU29ydCkuXG4gIGNvbnN0IGFwcGx5QnRuID0gdGl0bGVHcm91cC5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb25cIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJBcHBseSB0byBhbGwgbm90ZXNcIiB9IH0pO1xuICBzZXRJY29uKGFwcGx5QnRuLCBcInBsYXlcIik7XG4gIGFwcGx5QnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBhc3luYyAoKSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHJ1bkZyb250bWF0dGVyU29ydChwbHVnaW4sIG51bGwpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKFwiW0Zyb250bWF0dGVyIHNvcnRpbmddXCIsIGVycm9yKTtcbiAgICAgIG5ldyBOb3RpY2UoYEZyb250bWF0dGVyIHNvcnRpbmcgZmFpbGVkOiAke2Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgfVxuICB9KTtcblxuICB0aXRsZUdyb3VwLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtZGV0YWlsLXNlY3Rpb24tdGl0bGVcIiwgdGV4dDogXCJHbG9iYWwgcHJvcGVydHkgb3JkZXJcIiB9KTtcblxuICBjb25zdCBhZGRCdG4gPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uXCIsIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiQWRkIHByb3BlcnR5XCIgfSB9KTtcbiAgc2V0SWNvbihhZGRCdG4sIFwicGx1c1wiKTtcblxuICBjb25zdCBsaXN0RWwgPSBjb250YWluZXJFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLW9yZGVyLWxpc3RcIiB9KTtcblxuICBjb25zdCBvcmRlciA9ICgpID0+IHBsdWdpbi5zZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyO1xuXG4gIC8vIEEgbmV3IHJvdyBvbmx5IGpvaW5zIGdsb2JhbFByb3BlcnR5T3JkZXIgb25jZSBpdCBoYXMgYSB2YWxpZCBuYW1lLiBVbnRpbFxuICAvLyB0aGVuIGl0IGlzIGEgbG9jYWwgZHJhZnQgYXBwZW5kZWQgb24gcmVuZGVyLCBzbyBhbiBlbXB0eSBuYW1lIG5ldmVyIGVuZHNcbiAgLy8gdXAgaW4gdGhlIHNldHRpbmdzLCBldmVuIGlmIHNvbWV0aGluZyBlbHNlIHNhdmVzIGluIGJldHdlZW4uXG4gIGxldCBkcmFmdEVudHJ5ID0gbnVsbDtcblxuICBjb25zdCBpc0R1cGxpY2F0ZU5hbWUgPSAodmFsdWUsIG93bkVudHJ5KSA9PiB7XG4gICAgY29uc3QgbG93ZXIgPSB2YWx1ZS50b0xvd2VyQ2FzZSgpO1xuICAgIGlmIChsb3dlciA9PT0gVFlQX1BST1BFUlRZLnRvTG93ZXJDYXNlKCkgfHwgbG93ZXIgPT09IFNVQlRZUF9QUk9QRVJUWS50b0xvd2VyQ2FzZSgpKSByZXR1cm4gdHJ1ZTtcbiAgICByZXR1cm4gb3JkZXIoKS5zb21lKChvdGhlcikgPT4gb3RoZXIgIT09IG93bkVudHJ5ICYmIG90aGVyLmtpbmQgPT09IFwicHJvcGVydHlcIiAmJiBvdGhlci5uYW1lLnRvTG93ZXJDYXNlKCkgPT09IGxvd2VyKTtcbiAgfTtcblxuICBjb25zdCByZW5kZXIgPSAoKSA9PiB7XG4gICAgbGlzdEVsLmVtcHR5KCk7XG4gICAgY29uc3QgZW50cmllcyA9IGRyYWZ0RW50cnkgPyBbLi4ub3JkZXIoKSwgZHJhZnRFbnRyeV0gOiBvcmRlcigpO1xuXG4gICAgZW50cmllcy5mb3JFYWNoKChlbnRyeSwgaW5kZXgpID0+IHtcbiAgICAgIGNvbnN0IGlzRHJhZnQgPSBlbnRyeSA9PT0gZHJhZnRFbnRyeTtcbiAgICAgIGNvbnN0IGlzUGxhY2Vob2xkZXIgPSBlbnRyeS5raW5kICE9PSBcInByb3BlcnR5XCI7XG4gICAgICBjb25zdCByb3dDbHMgPVxuICAgICAgICBcInR5cC1vcmRlci1yb3dcIiArIChpc1BsYWNlaG9sZGVyID8gXCIgaXMtcGxhY2Vob2xkZXJcIiA6IFwiXCIpICsgKGVudHJ5LmtpbmQgPT09IFwidHlwXCIgPyBcIiBpcy10eXAtZGVmYXVsdHNcIiA6IFwiXCIpO1xuICAgICAgY29uc3Qgcm93ID0gbGlzdEVsLmNyZWF0ZURpdih7IGNsczogcm93Q2xzIH0pO1xuXG4gICAgICBjb25zdCBkcmFnSGFuZGxlID0gcm93LmNyZWF0ZURpdih7IGNsczogXCJ0eXAtb3JkZXItZHJhZ1wiLCBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIkRyYWcgdG8gbW92ZVwiIH0gfSk7XG4gICAgICBzZXRJY29uKGRyYWdIYW5kbGUsIFwiZ3JpcC12ZXJ0aWNhbFwiKTtcblxuICAgICAgaWYgKGlzUGxhY2Vob2xkZXIpIHtcbiAgICAgICAgLy8gT24gdGhlIGxhYmVsLCBub3QgdGhlIHJvdzogdGhlIGRyYWcgaGFuZGxlIGhhcyBhIHRvb2x0aXAgb2YgaXRzIG93bi5cbiAgICAgICAgcm93LmNyZWF0ZURpdih7XG4gICAgICAgICAgY2xzOiBcInR5cC1vcmRlci1sYWJlbFwiLFxuICAgICAgICAgIHRleHQ6IFBMQUNFSE9MREVSX0xBQkVMU1tlbnRyeS5raW5kXSxcbiAgICAgICAgICBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBQTEFDRUhPTERFUl9ERVNDUklQVElPTlNbZW50cnkua2luZF0gfSxcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zdCBpbnB1dCA9IHJvdy5jcmVhdGVFbChcImlucHV0XCIsIHtcbiAgICAgICAgICB0eXBlOiBcInRleHRcIixcbiAgICAgICAgICBjbHM6IFwidHlwLW9yZGVyLW5hbWUtaW5wdXRcIixcbiAgICAgICAgICBhdHRyOiB7IHBsYWNlaG9sZGVyOiBcIlByb3BlcnR5IG5hbWVcIiB9LFxuICAgICAgICB9KTtcbiAgICAgICAgaW5wdXQudmFsdWUgPSBlbnRyeS5uYW1lO1xuXG4gICAgICAgIC8vIFwiYmx1clwiLCBub3QgXCJjaGFuZ2VcIjogY2hhbmdlIGRvZXNuJ3QgZmlyZSBmb3IgYSBmaWVsZCBsZWZ0IGVtcHR5LCBzb1xuICAgICAgICAvLyB0aGUgZHJhZnQgd291bGQgbmV2ZXIgYmUgY2xlYW5lZCB1cC5cbiAgICAgICAgaW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImJsdXJcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGNvbnN0IHZhbHVlID0gaW5wdXQudmFsdWUudHJpbSgpO1xuXG4gICAgICAgICAgaWYgKCF2YWx1ZSkge1xuICAgICAgICAgICAgaWYgKGlzRHJhZnQpIHtcbiAgICAgICAgICAgICAgZHJhZnRFbnRyeSA9IG51bGw7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBvcmRlcigpLnNwbGljZShvcmRlcigpLmluZGV4T2YoZW50cnkpLCAxKTtcbiAgICAgICAgICAgICAgYXdhaXQgcGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmVuZGVyKCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKGlzRHVwbGljYXRlTmFtZSh2YWx1ZSwgaXNEcmFmdCA/IG51bGwgOiBlbnRyeSkpIHtcbiAgICAgICAgICAgIG5ldyBOb3RpY2UoYFwiJHt2YWx1ZX1cIiBpcyBhbHJlYWR5IGluIHRoZSBsaXN0LmApO1xuICAgICAgICAgICAgaW5wdXQudmFsdWUgPSBlbnRyeS5uYW1lO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGVudHJ5Lm5hbWUgPSB2YWx1ZTtcbiAgICAgICAgICBpZiAoaXNEcmFmdCkge1xuICAgICAgICAgICAgb3JkZXIoKS5wdXNoKGVudHJ5KTtcbiAgICAgICAgICAgIGRyYWZ0RW50cnkgPSBudWxsO1xuICAgICAgICAgIH1cbiAgICAgICAgICBhd2FpdCBwbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgcmVuZGVyKCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IHJlbW92ZUJ0biA9IHJvdy5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLW9yZGVyLXJlbW92ZSBjbGlja2FibGUtaWNvblwiLCBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIlJlbW92ZVwiIH0gfSk7XG4gICAgICAgIHNldEljb24ocmVtb3ZlQnRuLCBcInhcIik7XG4gICAgICAgIHJlbW92ZUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGlmIChpc0RyYWZ0KSB7XG4gICAgICAgICAgICBkcmFmdEVudHJ5ID0gbnVsbDtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgb3JkZXIoKS5zcGxpY2Uob3JkZXIoKS5pbmRleE9mKGVudHJ5KSwgMSk7XG4gICAgICAgICAgICBhd2FpdCBwbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJlbmRlcigpO1xuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgLy8gQSBkcmFmdCBoYXMgbm8gcGxhY2UgaW4gdGhlIHJlYWwgbGlzdCB5ZXQsIHNvIGl0IGNhbid0IGJlIG1vdmVkLlxuICAgICAgaWYgKGlzRHJhZnQpIHJldHVybjtcblxuICAgICAgcm93LmRyYWdnYWJsZSA9IHRydWU7XG4gICAgICByb3cuYWRkRXZlbnRMaXN0ZW5lcihcImRyYWdzdGFydFwiLCAoZXZlbnQpID0+IHtcbiAgICAgICAgZXZlbnQuZGF0YVRyYW5zZmVyLmVmZmVjdEFsbG93ZWQgPSBcIm1vdmVcIjtcbiAgICAgICAgZXZlbnQuZGF0YVRyYW5zZmVyLnNldERhdGEoXCJ0ZXh0L3BsYWluXCIsIFN0cmluZyhpbmRleCkpO1xuICAgICAgICByb3cuY2xhc3NMaXN0LmFkZChcImlzLWRyYWdnaW5nXCIpO1xuICAgICAgfSk7XG4gICAgICByb3cuYWRkRXZlbnRMaXN0ZW5lcihcImRyYWdlbmRcIiwgKCkgPT4gcm93LmNsYXNzTGlzdC5yZW1vdmUoXCJpcy1kcmFnZ2luZ1wiKSk7XG4gICAgICByb3cuYWRkRXZlbnRMaXN0ZW5lcihcImRyYWdvdmVyXCIsIChldmVudCkgPT4ge1xuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAvLyBVcHBlciBvciBsb3dlciBoYWxmIGRlY2lkZXMgYmVmb3JlL2FmdGVyIC0gb3RoZXJ3aXNlIG5vdGhpbmcgY291bGRcbiAgICAgICAgLy8gYmUgZHJvcHBlZCBiZWxvdyB0aGUgbGFzdCByb3cuXG4gICAgICAgIGNvbnN0IHJlY3QgPSByb3cuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgICAgIGNvbnN0IGlzQWZ0ZXIgPSBldmVudC5jbGllbnRZIC0gcmVjdC50b3AgPiByZWN0LmhlaWdodCAvIDI7XG4gICAgICAgIHJvdy5jbGFzc0xpc3QudG9nZ2xlKFwiaXMtZHJvcC1iZWZvcmVcIiwgIWlzQWZ0ZXIpO1xuICAgICAgICByb3cuY2xhc3NMaXN0LnRvZ2dsZShcImlzLWRyb3AtYWZ0ZXJcIiwgaXNBZnRlcik7XG4gICAgICB9KTtcbiAgICAgIHJvdy5hZGRFdmVudExpc3RlbmVyKFwiZHJhZ2xlYXZlXCIsICgpID0+IHJvdy5jbGFzc0xpc3QucmVtb3ZlKFwiaXMtZHJvcC1iZWZvcmVcIiwgXCJpcy1kcm9wLWFmdGVyXCIpKTtcbiAgICAgIHJvdy5hZGRFdmVudExpc3RlbmVyKFwiZHJvcFwiLCBhc3luYyAoZXZlbnQpID0+IHtcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgY29uc3QgaXNBZnRlciA9IHJvdy5jbGFzc0xpc3QuY29udGFpbnMoXCJpcy1kcm9wLWFmdGVyXCIpO1xuICAgICAgICByb3cuY2xhc3NMaXN0LnJlbW92ZShcImlzLWRyb3AtYmVmb3JlXCIsIFwiaXMtZHJvcC1hZnRlclwiKTtcblxuICAgICAgICBjb25zdCBmcm9tSW5kZXggPSBOdW1iZXIoZXZlbnQuZGF0YVRyYW5zZmVyLmdldERhdGEoXCJ0ZXh0L3BsYWluXCIpKTtcbiAgICAgICAgaWYgKE51bWJlci5pc05hTihmcm9tSW5kZXgpKSByZXR1cm47XG5cbiAgICAgICAgLy8gVGFyZ2V0IGluZGV4IGNvdW50ZWQgYmVmb3JlIGZyb21JbmRleCBpcyByZW1vdmVkLlxuICAgICAgICBsZXQgaW5zZXJ0QmVmb3JlID0gaXNBZnRlciA/IGluZGV4ICsgMSA6IGluZGV4O1xuICAgICAgICBpZiAoZnJvbUluZGV4IDwgaW5zZXJ0QmVmb3JlKSBpbnNlcnRCZWZvcmUgLT0gMTtcblxuICAgICAgICBjb25zdCBbbW92ZWRdID0gb3JkZXIoKS5zcGxpY2UoZnJvbUluZGV4LCAxKTtcbiAgICAgICAgb3JkZXIoKS5zcGxpY2UoaW5zZXJ0QmVmb3JlLCAwLCBtb3ZlZCk7XG4gICAgICAgIGF3YWl0IHBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgcmVuZGVyKCk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfTtcblxuICBhZGRCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICBpZiAoIWRyYWZ0RW50cnkpIHtcbiAgICAgIGRyYWZ0RW50cnkgPSB7IGtpbmQ6IFwicHJvcGVydHlcIiwgbmFtZTogXCJcIiB9O1xuICAgICAgcmVuZGVyKCk7XG4gICAgfVxuICAgIGNvbnN0IGlucHV0cyA9IGxpc3RFbC5xdWVyeVNlbGVjdG9yQWxsKFwiLnR5cC1vcmRlci1uYW1lLWlucHV0XCIpO1xuICAgIGlucHV0c1tpbnB1dHMubGVuZ3RoIC0gMV0/LmZvY3VzKCk7XG4gIH0pO1xuXG4gIHJlbmRlcigpO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgbW91bnRHbG9iYWxPcmRlckVkaXRvciB9O1xuIiwgImNvbnN0IHsgUGx1Z2luU2V0dGluZ1RhYiwgU2V0dGluZ0dyb3VwLCBUb2dnbGVDb21wb25lbnQsIERyb3Bkb3duQ29tcG9uZW50LCBkZWJvdW5jZSB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyBtb3VudEdsb2JhbE9yZGVyRWRpdG9yIH0gPSByZXF1aXJlKFwiLi9mcm9udG1hdHRlci1vcmRlci1lZGl0b3JcIik7XG5jb25zdCB7IERFRkFVTFRfR0xPQkFMX09SREVSIH0gPSByZXF1aXJlKFwiLi9mcm9udG1hdHRlci1zb3J0XCIpO1xuY29uc3QgeyBTVUJUWVBfQ09MT1JfQ0hBTk5FTFMsIERFRkFVTFRfU1VCVFlQX0NPTE9SX1JBTkdFUywgY29sb3JSYW5nZSB9ID0gcmVxdWlyZShcIi4vdHlwLWNvbG9yc1wiKTtcblxuY29uc3QgREVGQVVMVF9TRVRUSU5HUyA9IHtcbiAgdHlwczogW10sXG4gIHR5cENvbG9yczoge30sXG4gIHR5cERlc2NyaXB0aW9uczoge30sXG4gIHR5cERlZmF1bHRGcm9udG1hdHRlcjoge30sXG4gIC8vIEtleXMgb2YgdHlwRGVmYXVsdEZyb250bWF0dGVyW3R5cF0gbWFya2VkIGFzIGZsb2F0aW5nLiBUaGV5IHNoYXJlIHRoZSBsaXN0XG4gIC8vIGFuZCBpdHMgb3JkZXIgKHdoaWNoIGZyb250bWF0dGVyIHNvcnRpbmcgdXNlcyksIGJ1dCBnZXRUeXBEZWZhdWx0cygpIGxlYXZlc1xuICAvLyB0aGVtIG91dCB1bmxlc3MgYXNrZWQgd2l0aCBpbmNsdWRlRmxvYXRpbmcsIHNvIG5ldyBub3RlcyBkb24ndCBnZXQgdGhlbVxuICAvLyBhdXRvbWF0aWNhbGx5LlxuICB0eXBGbG9hdGluZ0tleXM6IHt9LFxuICAvLyBTaG9ydGN1dHMgcGVyIGtleSBvZiB0eXBEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwXTpcbiAgLy8gICB7IFtUWVBdOiB7IFtQcm9wZXJ0eV06IHsgbmFtZTogXCJ0b2RheVwiIHwgXCJ0cC48c2NyaXB0PlwiIH0gfSB9XG4gIC8vIEtlcHQgTkVYVCBUTyB0aGUgZnJvbnRtYXR0ZXIsIG5vdCBhcyBpdHMgdmFsdWUgLSBzZWUgc2hvcnRjdXRzLmpzLlxuICB0eXBTaG9ydGN1dHM6IHt9LFxuICB0eXBNYW51YWw6IHt9LFxuICAvLyBSZWdpc3RlcmVkIFN1YnR5cHMgcGVyIFRZUCB3aXRoIHRoZWlyIG93biBmcm9udG1hdHRlciBibG9jaywgc2VlIHN1YnR5cHMuanMuXG4gIHR5cFN1YnR5cHM6IHt9LFxuICAvLyBQaW5uZWQgc2luZ2xlIHByb3BlcnRpZXMgKGtpbmQ6IFwicHJvcGVydHlcIikgcGx1cyB0aGUgZm91ciBmaXhlZFxuICAvLyBwbGFjZWhvbGRlcnMgXCJ0eXBWYWx1ZVwiLCBcInN1YnR5cFZhbHVlXCIsIFwidHlwXCIgYW5kIFwib3RoZXJcIiAtIHNlZVxuICAvLyBmcm9udG1hdHRlci1zb3J0LmpzLlxuICBnbG9iYWxQcm9wZXJ0eU9yZGVyOiBERUZBVUxUX0dMT0JBTF9PUkRFUixcbiAgLy8gSG93IHRoZSBvcGVuIG5vdGUgc2hvd3MgaXRzIFRZUCAoc2VlIGFjdGl2ZS10aXRsZS1jb2xvcnMuanMpOiBcIm5vbmVcIixcbiAgLy8gXCJkb3RcIiBvciBcImJhZGdlXCIuIFRoZSB0aHJlZSBiYWRnZSBzZXR0aW5ncyBiZWxvdyBvbmx5IG1hdHRlciBmb3IgXCJiYWRnZVwiLlxuICAvLyBjb2xvclZpZXdzLm5vdGVUaXRsZUNvbG9yICh0aGUgdGl0bGUgdGV4dCBpdHNlbGYpIGlzIGluZGVwZW5kZW50LlxuICBub3RlVGl0bGVTdHlsZTogXCJkb3RcIixcbiAgLy8gQmFkZ2UgY29sb3JlZCAoVFlQIGNvbG9yKSBvciBuZXV0cmFsICh0ZXh0LW11dGVkKS5cbiAgbm90ZVRpdGxlQmFkZ2VDb2xvcmVkOiB0cnVlLFxuICAvLyBCYWRnZSBsYWJlbDogXCJ0eXBcIiAoW1RZUF0pLCBcInR5cC1zdWJ0eXBcIiAoW1RZUC9TdWJ0eXBdKSBvciBcInN1YnR5cFwiXG4gIC8vIChbU3VidHlwXTsgbm8gYmFkZ2Ugd2l0aG91dCBhIFN1YnR5cCkuIENvbG9yZWQgaW4gdGhlIFRZUCBvciBTdWJ0eXAgY29sb3I7XG4gIC8vIGZvciBcInR5cC1zdWJ0eXBcIiBjaG9zZW4gd2l0aCBjb2xvclZpZXdzLm5vdGVUaXRsZU1hcmtlclN1YnR5cC5cbiAgbm90ZVRpdGxlQmFkZ2VMYWJlbDogXCJ0eXBcIixcbiAgLy8gXCJ0aXRsZVwiIChuZXh0IHRvIHRoZSBpbmxpbmUgdGl0bGUpIG9yIFwiYmxvY2tcIiAobGVmdCBvZiB0aGUgcHJvcGVydHlcbiAgLy8gYmxvY2ssIHR1cm5lZCA5MFx1MDBCMCkuXG4gIG5vdGVUaXRsZUJhZGdlUG9zaXRpb246IFwidGl0bGVcIixcbiAgLy8gRm9yIHBvc2l0aW9uIFwiYmxvY2tcIjogdG9wIG9yIGJvdHRvbSBlZGdlIG9mIHRoZSBwcm9wZXJ0eSBibG9jay5cbiAgbm90ZVRpdGxlVmVydGljYWxBbGlnbjogXCJ0b3BcIixcbiAgdHlwU29ydE9yZGVyOiBcImNvdW50LWRlc2NcIixcbiAgLy8gV2hhdCB0aGUgVFlQLUxpc3Qgc2hvd3MgbmV4dCB0byB0aGUgbmFtZTogXCJzdWJ0eXBzXCIsIFwiZGVzY3JpcHRpb25cIiBvclxuICAvLyBcIm5vbmVcIi4gU3dpdGNoZWQgYnkgdGhlIGhlYWRlciBidXR0b24gbmV4dCB0byBzb3J0aW5nIChTRUNPTkRBUllfTU9ERVMgaW5cbiAgLy8gdHlwLXBhbmUuanMpLCBub3QgaGVyZTogbGlrZSB0aGUgc29ydCBvcmRlciBpdCBvbmx5IGNvbmNlcm5zIHRoYXQgbGlzdC5cbiAgdHlwTGlzdFNlY29uZGFyeTogXCJzdWJ0eXBzXCIsXG4gIC8vIFNlZSBwaWNrVHlwQW5kU3VidHlwIGluIHR5cC1waWNrZXIuanM6IGZhbHNlID0gZWFjaCBTdWJ0eXAgaW5kZW50ZWQgaW4gdGhlXG4gIC8vIFRZUC1QaWNrZXIsIHRydWUgPSBhIHNlcGFyYXRlIFN1YnR5cC1QaWNrZXIgYWZ0ZXIgdGhlIFRZUCBjaG9pY2UuXG4gIHNlcGFyYXRlU3VidHlwUGlja2VyOiBmYWxzZSxcbiAgaW5jbHVkZUlnbm9yZWRGaWxlczogZmFsc2UsXG4gIC8vIEFzayBiZWZvcmUgZGVsZXRpbmcgYSBUWVAgb3IgYSBTdWJ0eXAgd2l0aCBwcm9wZXJ0aWVzLiBPbmx5IGRlbGV0aW9ucyB0aGF0XG4gIC8vIHRvdWNoIG5vdGhpbmcgYnV0IHRoZXNlIHNldHRpbmdzIGNhbiBiZSBzd2l0Y2hlZCBvZmYgKFwiRG9uJ3QgYXNrIGFnYWluXCIgaW5cbiAgLy8gdGhlIGRpYWxvZykgLSB0aGV5IGNhbiBiZSB1bmRvbmUgKHVuZG8uanMpLiBBbnl0aGluZyB0aGF0IHJld3JpdGVzIG5vdGVzXG4gIC8vIG9yIGZpbGVzIGFsd2F5cyBhc2tzLlxuICBjb25maXJtRGVsZXRpb246IHRydWUsXG4gIC8vIE93biB0YWcvYXR0YWNobWVudCBjb2xvcnMgaW4gdGhlIGdyYXBoIGRpc2FibGVkICgyMDI2LTA5LTMwKTogdGhlIE1pbmltYWxcbiAgLy8gdGhlbWUncyBTdHlsZSBTZXR0aW5ncyBjb3ZlciBib3RoLCBzZWUgZ3JhcGgtY29sb3JzLmpzLlxuICAvLyBncmFwaFRhZ0NvbG9yRW5hYmxlZDogZmFsc2UsXG4gIC8vIGdyYXBoVGFnQ29sb3I6IFwiXCIsXG4gIC8vIGdyYXBoQXR0YWNobWVudENvbG9yRW5hYmxlZDogZmFsc2UsXG4gIC8vIGdyYXBoQXR0YWNobWVudENvbG9yOiBcIlwiLFxuICAvLyBIb3cgZmFyIGEgU3VidHlwJ3MgY29sb3IgbWF5IGRpZmZlciBmcm9tIGl0cyBUWVAncyAoXHUwMEIxKSwgc2VlIHR5cC1jb2xvcnMuanM6XG4gIC8vIGh1ZSBpbiBkZWdyZWVzLCBsaWdodG5lc3MgaW4gJSBvZiB0aGUgd2F5IHRvIHdoaXRlIG9yIGJsYWNrLlxuICBzdWJ0eXBDb2xvclJhbmdlczogeyAuLi5ERUZBVUxUX1NVQlRZUF9DT0xPUl9SQU5HRVMgfSxcbiAgY29sb3JWaWV3czoge1xuICAgIGZpbGVFeHBsb3JlcjogdHJ1ZSxcbiAgICBncmFwaDogdHJ1ZSxcbiAgICBzZWFyY2g6IHRydWUsXG4gICAgcmVjZW50RmlsZXM6IHRydWUsXG4gICAgYmFja2xpbmtzOiB0cnVlLFxuICAgIGJvb2ttYXJrczogdHJ1ZSxcbiAgICAvLyBcIjx2aWV3PlN1YnR5cFwiIHN1Yi10b2dnbGVzOiB1c2UgYSBub3RlJ3MgU3VidHlwIGNvbG9yIGluc3RlYWQgb2YgaXRzXG4gICAgLy8gVFlQJ3MgKHNlZSBjb2xvckZvckZpbGUgaW4gdHlwLWNvbG9ycy5qcykuXG4gICAgZmlsZUV4cGxvcmVyU3VidHlwOiB0cnVlLFxuICAgIGdyYXBoU3VidHlwOiB0cnVlLFxuICAgIHNlYXJjaFN1YnR5cDogdHJ1ZSxcbiAgICByZWNlbnRGaWxlc1N1YnR5cDogdHJ1ZSxcbiAgICBiYWNrbGlua3NTdWJ0eXA6IHRydWUsXG4gICAgYm9va21hcmtzU3VidHlwOiB0cnVlLFxuICAgIGxpbmtzU3VidHlwOiB0cnVlLFxuICAgIHR5cExpc3RTdWJ0eXA6IHRydWUsXG4gICAgbm90ZVRpdGxlQ29sb3JTdWJ0eXA6IHRydWUsXG4gICAgbm90ZVRpdGxlTWFya2VyU3VidHlwOiB0cnVlLFxuICAgIGZyb250bWF0dGVyRGVmYXVsdHM6IHRydWUsXG4gICAgLy8gU3ViLXRvZ2dsZSBvZiBmcm9udG1hdHRlckRlZmF1bHRzIGFuZCBhbGxQcm9wZXJ0aWVzOiBpbmNsdWRlIHRoZSBTdWJ0eXBcbiAgICAvLyBibG9ja3MgKHNlZSBmcm9udG1hdHRlci1kZWZhdWx0LWhpZ2hsaWdodC5qcyk7IGZvciBhbGxQcm9wZXJ0aWVzIGFsc28gaW5cbiAgICAvLyB0aGUgU3VidHlwIGNvbG9yLlxuICAgIGZyb250bWF0dGVyRGVmYXVsdHNTdWJ0eXA6IHRydWUsXG4gICAgdHlwTGlzdDogdHJ1ZSxcbiAgICBhbGxQcm9wZXJ0aWVzOiB0cnVlLFxuICAgIGFsbFByb3BlcnRpZXNTdWJ0eXA6IHRydWUsXG4gICAgbm90ZVRpdGxlQ29sb3I6IHRydWUsXG4gICAgbGlua3M6IHRydWUsXG4gIH0sXG59O1xuXG5jbGFzcyBUeXBTeXN0ZW1TZXR0aW5nVGFiIGV4dGVuZHMgUGx1Z2luU2V0dGluZ1RhYiB7XG4gIGNvbnN0cnVjdG9yKGFwcCwgcGx1Z2luKSB7XG4gICAgc3VwZXIoYXBwLCBwbHVnaW4pO1xuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xuICB9XG5cbiAgLy8gRWFjaCBzZWN0aW9uIGlzIGEgU2V0dGluZ0dyb3VwIChoZWFkaW5nIHBsdXMgb25lIGJveCwgZW50cmllcyBzZXBhcmF0ZWQgYnlcbiAgLy8gbGluZXMpLCBsaWtlIE9ic2lkaWFuJ3MgY29yZSBzZXR0aW5ncy4gU2V0dGluZ3MgY3JlYXRlZCBvbmUgYnkgb25lIHdpdGhcbiAgLy8gbmV3IFNldHRpbmcoY29udGFpbmVyRWwpIHdvdWxkIGVhY2ggZ2V0IHRoZWlyIG93biBzbWFsbCBib3guXG4gIGRpc3BsYXkoKSB7XG4gICAgY29uc3QgeyBjb250YWluZXJFbCB9ID0gdGhpcztcbiAgICAvLyBLZWVwIHRoZSBzY3JvbGwgcG9zaXRpb24gYWNyb3NzIHJlYnVpbGRzICh0b2dnbGVzIHdpdGggc3ViLW9wdGlvbnMgY2FsbFxuICAgIC8vIGRpc3BsYXkoKSk6IHRoZSBUWVAgbWFya2VyIGRyb3Bkb3duIG1lYXN1cmVzIGl0c2VsZiBvbiBzZXRWYWx1ZSgpIGFuZFxuICAgIC8vIGZvcmNlcyBhIGxheW91dCB3aGlsZSB0aGUgcGFnZSBpcyBvbmx5IHBhcnRseSBidWlsdCwgc28gdGhlIGJyb3dzZXJcbiAgICAvLyBjbGFtcHMgc2Nyb2xsVG9wIHRvIHRoYXQgaGVpZ2h0IGFuZCB0aGUgcGFnZSB3b3VsZCBqdW1wIHVwLlxuICAgIGNvbnN0IHsgc2Nyb2xsVG9wIH0gPSBjb250YWluZXJFbDtcbiAgICBjb250YWluZXJFbC5lbXB0eSgpO1xuXG4gICAgbmV3IFNldHRpbmdHcm91cChjb250YWluZXJFbClcbiAgICAgIC5zZXRIZWFkaW5nKFwiR2VuZXJhbFwiKVxuICAgICAgLmFkZFNldHRpbmcoKHNldHRpbmcpID0+XG4gICAgICAgIHNldHRpbmdcbiAgICAgICAgICAuc2V0TmFtZShcIkluY2x1ZGUgZXhjbHVkZWQgZmlsZXNcIilcbiAgICAgICAgICAuc2V0RGVzYyhcbiAgICAgICAgICAgIFwiQ291bnQgbm90ZXMgZnJvbSBPYnNpZGlhbidzIFxcXCJFeGNsdWRlZCBmaWxlc1xcXCIgKGUuZy4gZm9sZGVycyBoaWRkZW4gYnkgSGlkZSBGb2xkZXJzKSBpbiBUWVAgY291bnRzLCB0aGUgVFlQLVBpY2tlciBhbmQgZnJvbnRtYXR0ZXIgc29ydGluZy5cIlxuICAgICAgICAgIClcbiAgICAgICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgICAgICB0b2dnbGUuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MuaW5jbHVkZUlnbm9yZWRGaWxlcykub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmluY2x1ZGVJZ25vcmVkRmlsZXMgPSB2YWx1ZTtcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgICApXG4gICAgICApXG4gICAgICAuYWRkU2V0dGluZygoc2V0dGluZykgPT5cbiAgICAgICAgc2V0dGluZ1xuICAgICAgICAgIC5zZXROYW1lKFwiQ29uZmlybSBkZWxldGlvblwiKVxuICAgICAgICAgIC5zZXREZXNjKFxuICAgICAgICAgICAgXCJBc2sgYmVmb3JlIGRlbGV0aW5nIGEgVFlQIG9yIGEgU3VidHlwIHdpdGggcHJvcGVydGllcy4gV2hlbiBvZmYsIHRoZXkgYXJlIGRlbGV0ZWQgYXQgb25jZTsgZWl0aGVyIHdheSB0aGUgbm90aWNlIGFmdGVyd2FyZHMgb2ZmZXJzIFVuZG8uIERpYWxvZ3MgdGhhdCByZXdyaXRlIG5vdGVzIChyZW5hbWUgYW5kIHVwZGF0ZSBub3RlcywgbWVyZ2UpIGFsd2F5cyBhc2suXCJcbiAgICAgICAgICApXG4gICAgICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbmZpcm1EZWxldGlvbikub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbmZpcm1EZWxldGlvbiA9IHZhbHVlO1xuICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgKVxuICAgICAgKVxuICAgICAgLmFkZFNldHRpbmcoKHNldHRpbmcpID0+XG4gICAgICAgIHNldHRpbmdcbiAgICAgICAgICAuc2V0TmFtZShcIlNlcGFyYXRlIFN1YnR5cC1QaWNrZXJcIilcbiAgICAgICAgICAuc2V0RGVzYyhcbiAgICAgICAgICAgIFwiQWZ0ZXIgY2hvb3NpbmcgYSBUWVAsIGNob29zZSB0aGUgU3VidHlwIGluIGEgc2Vjb25kIHBpY2tlci4gV2hlbiBvZmYsIGVhY2ggU3VidHlwIGlzIGxpc3RlZCBpbmRlbnRlZCBiZWxvdyBpdHMgVFlQLlwiXG4gICAgICAgICAgKVxuICAgICAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgICAgIHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5zZXBhcmF0ZVN1YnR5cFBpY2tlcikub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnNlcGFyYXRlU3VidHlwUGlja2VyID0gdmFsdWU7XG4gICAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgICApXG4gICAgICApO1xuXG4gICAgLy8gc3VidHlwS2V5IChvcHRpb25hbCk6IHR3byBsYWJlbGVkIHRvZ2dsZXMgaW5zdGVhZCBvZiBvbmUgLSBcIlRZUFwiIGZvciB0aGVcbiAgICAvLyBzZXR0aW5nIGl0c2VsZiBhbmQgYmVsb3cgaXQgXCJTdWJ0eXBcIiwgc2hvd24gb25seSB3aGlsZSBcIlRZUFwiIGlzIG9uLiBUaGVcbiAgICAvLyBkZWZhdWx0IHRvb2x0aXBzIGZpdCB0aGUgY29sb3JpbmcgdG9nZ2xlcy5cbiAgICBjb25zdCBjb2xvclZpZXdUb2dnbGUgPSAoXG4gICAgICBncm91cCxcbiAgICAgIGtleSxcbiAgICAgIG5hbWUsXG4gICAgICBkZXNjLFxuICAgICAgc3VidHlwS2V5ID0gbnVsbCxcbiAgICAgIHsgdHlwVG9vbHRpcCA9IFwiQ29sb3IgYnkgVFlQXCIsIHN1YnR5cFRvb2x0aXAgPSBcIlVzZSBTdWJ0eXAgY29sb3IgaW5zdGVhZCBvZiBUWVAgY29sb3JcIiB9ID0ge31cbiAgICApID0+XG4gICAgICBncm91cC5hZGRTZXR0aW5nKChzZXR0aW5nKSA9PiB7XG4gICAgICAgIHNldHRpbmcuc2V0TmFtZShuYW1lKS5zZXREZXNjKGRlc2MpO1xuICAgICAgICBjb25zdCBzYXZlID0gYXN5bmMgKHNldHRpbmdLZXksIHZhbHVlKSA9PiB7XG4gICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3c1tzZXR0aW5nS2V5XSA9IHZhbHVlO1xuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgICAgICB9O1xuXG4gICAgICAgIGlmICghc3VidHlwS2V5KSB7XG4gICAgICAgICAgc2V0dGluZy5hZGRUb2dnbGUoKHRvZ2dsZSkgPT4gdG9nZ2xlLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3Nba2V5XSkub25DaGFuZ2UoKHZhbHVlKSA9PiBzYXZlKGtleSwgdmFsdWUpKSk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgc2V0dGluZy5zZXR0aW5nRWwuYWRkQ2xhc3MoXCJ0eXAtbm90ZS10aXRsZS1zZXR0aW5nXCIpO1xuICAgICAgICBjb25zdCBhZGRSb3cgPSAobGFiZWwsIHRvb2x0aXAsIHNldHRpbmdLZXksIG9uQ2hhbmdlZCkgPT4ge1xuICAgICAgICAgIGNvbnN0IHJvdyA9IHNldHRpbmcuY29udHJvbEVsLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtbm90ZS10aXRsZS10b2dnbGUtcm93XCIgfSk7XG4gICAgICAgICAgcm93LmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLW5vdGUtdGl0bGUtdG9nZ2xlLWxhYmVsXCIsIHRleHQ6IGxhYmVsIH0pO1xuICAgICAgICAgIG5ldyBUb2dnbGVDb21wb25lbnQocm93KVxuICAgICAgICAgICAgLnNldFRvb2x0aXAodG9vbHRpcClcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzW3NldHRpbmdLZXldKVxuICAgICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgICBhd2FpdCBzYXZlKHNldHRpbmdLZXksIHZhbHVlKTtcbiAgICAgICAgICAgICAgb25DaGFuZ2VkPy4oKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9O1xuICAgICAgICBhZGRSb3coXCJUWVBcIiwgdHlwVG9vbHRpcCwga2V5LCAoKSA9PiB0aGlzLmRpc3BsYXkoKSk7XG4gICAgICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzW2tleV0pIGFkZFJvdyhcIlN1YnR5cFwiLCBzdWJ0eXBUb29sdGlwLCBzdWJ0eXBLZXkpO1xuICAgICAgfSk7XG5cbiAgICBjb25zdCBjb2xvcmluZ0dyb3VwID0gbmV3IFNldHRpbmdHcm91cChjb250YWluZXJFbCkuc2V0SGVhZGluZyhcIkNvbG9yaW5nXCIpO1xuXG4gICAgY29sb3JWaWV3VG9nZ2xlKGNvbG9yaW5nR3JvdXAsIFwiZmlsZUV4cGxvcmVyXCIsIFwiRmlsZSBleHBsb3JlclwiLCBcIkNvbG9yIG5vdGUgbmFtZXMgaW4gdGhlIGZpbGUgZXhwbG9yZXIuXCIsIFwiZmlsZUV4cGxvcmVyU3VidHlwXCIpO1xuICAgIGNvbG9yVmlld1RvZ2dsZShjb2xvcmluZ0dyb3VwLCBcImdyYXBoXCIsIFwiR3JhcGhcIiwgXCJDb2xvciBub2RlcyBpbiB0aGUgZ2xvYmFsIGFuZCBsb2NhbCBncmFwaC5cIiwgXCJncmFwaFN1YnR5cFwiKTtcbiAgICBjb2xvclZpZXdUb2dnbGUoY29sb3JpbmdHcm91cCwgXCJzZWFyY2hcIiwgXCJTZWFyY2hcIiwgXCJDb2xvciByZXN1bHQgdGl0bGVzIGluIHNlYXJjaC5cIiwgXCJzZWFyY2hTdWJ0eXBcIik7XG4gICAgY29sb3JWaWV3VG9nZ2xlKGNvbG9yaW5nR3JvdXAsIFwicmVjZW50RmlsZXNcIiwgXCJSZWNlbnQgRmlsZXNcIiwgXCJDb2xvciBlbnRyaWVzIGluIHRoZSBSZWNlbnQgRmlsZXMgcGx1Z2luLlwiLCBcInJlY2VudEZpbGVzU3VidHlwXCIpO1xuICAgIGNvbG9yVmlld1RvZ2dsZShcbiAgICAgIGNvbG9yaW5nR3JvdXAsXG4gICAgICBcImxpbmtzXCIsXG4gICAgICBcIkxpbmtzIGluIG5vdGVzXCIsXG4gICAgICBcIkNvbG9yIGludGVybmFsIGxpbmtzIGJ5IHRoZSBUWVAgb2YgdGhlaXIgdGFyZ2V0IChyZWFkaW5nIHZpZXcsIExpdmUgUHJldmlldywgaG92ZXIgcHJldmlldykuIFVucmVzb2x2ZWQgbGlua3Mgc3RheSBhcyB0aGV5IGFyZS5cIixcbiAgICAgIFwibGlua3NTdWJ0eXBcIlxuICAgICk7XG4gICAgY29sb3JWaWV3VG9nZ2xlKGNvbG9yaW5nR3JvdXAsIFwidHlwTGlzdFwiLCBcIlRZUC1QYW5lXCIsIFwiQ29sb3IgbmFtZXMgaW4gdGhlIFRZUC1QYW5lIGFuZCBUWVAtUGlja2VyLlwiLCBcInR5cExpc3RTdWJ0eXBcIik7XG4gICAgY29sb3JWaWV3VG9nZ2xlKFxuICAgICAgY29sb3JpbmdHcm91cCxcbiAgICAgIFwibm90ZVRpdGxlQ29sb3JcIixcbiAgICAgIFwiQ29sb3Igbm90ZSB0aXRsZVwiLFxuICAgICAgXCJDb2xvciB0aGUgaW5saW5lIHRpdGxlIG9mIHRoZSBvcGVuIG5vdGUuXCIsXG4gICAgICBcIm5vdGVUaXRsZUNvbG9yU3VidHlwXCJcbiAgICApO1xuXG4gICAgLy8gUHJvZ3Jlc3NpdmUgZGlzY2xvc3VyZTogXCJiYWRnZVwiIGFkZHMgdG9nZ2xlcyAoY29sb3IsIHBvc2l0aW9uKSB0byB0aGlzXG4gICAgLy8gb25lIHNldHRpbmcgcm93LCBwb3NpdGlvbiBcImJsb2NrXCIgb25lIG1vcmUgKGFsaWdubWVudCkuIEVhY2ggcmUtcmVuZGVyc1xuICAgIC8vIHZpYSBkaXNwbGF5KCkgc28gb25seSB0aGUgcmVsZXZhbnQgb25lcyBzaG93LlxuICAgIGNvbnN0IGlzQmFkZ2UgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVTdHlsZSA9PT0gXCJiYWRnZVwiO1xuICAgIGNvbnN0IGlzQmxvY2tQb3NpdGlvbiA9IHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZUJhZGdlUG9zaXRpb24gPT09IFwiYmxvY2tcIjtcblxuICAgIGNvbG9yaW5nR3JvdXAuYWRkU2V0dGluZygobm90ZVRpdGxlU2V0dGluZykgPT4ge1xuICAgICAgbm90ZVRpdGxlU2V0dGluZ1xuICAgICAgICAuc2V0TmFtZShcIlRZUCBtYXJrZXIgaW4gbm90ZVwiKVxuICAgICAgICAuc2V0RGVzYyhpc0JhZGdlID8gXCJCYWRnZSBvcHRpb25zOiBsYWJlbCwgY29sb3IsIHBvc2l0aW9uLlwiIDogXCJIb3cgdGhlIG9wZW4gbm90ZSBzaG93cyBpdHMgVFlQLlwiKVxuICAgICAgICAuYWRkRHJvcGRvd24oKGRyb3Bkb3duKSA9PlxuICAgICAgICAgIGRyb3Bkb3duXG4gICAgICAgICAgICAuYWRkT3B0aW9uKFwibm9uZVwiLCBcIk5vbmVcIilcbiAgICAgICAgICAgIC5hZGRPcHRpb24oXCJkb3RcIiwgXCJEb3QgYXQgdGl0bGVcIilcbiAgICAgICAgICAgIC5hZGRPcHRpb24oXCJiYWRnZVwiLCBcIkJhZGdlIHdpdGggVFlQIG5hbWVcIilcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVTdHlsZSlcbiAgICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlU3R5bGUgPSB2YWx1ZTtcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgICAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgICk7XG5cbiAgICAgIC8vIFwiU3VidHlwXCIgKFN1YnR5cCBjb2xvciBpbnN0ZWFkIG9mIFRZUCBjb2xvcikgb25seSB3aGlsZSB0aGUgbWFya2VyIGlzXG4gICAgICAvLyBjb2xvcmVkIGF0IGFsbDogYWx3YXlzIGZvciB0aGUgZG90LCBmb3IgdGhlIGJhZGdlIG9ubHkgd2l0aCBcIkNvbG9yZWRcIlxuICAgICAgLy8gYW5kIGxhYmVsIFtUWVAvU3VidHlwXSAtIHdpdGggW1RZUF0gb3IgW1N1YnR5cF0gdGhlIGNvbG9yIGZvbGxvd3MgdGhlXG4gICAgICAvLyBsYWJlbC5cbiAgICAgIGNvbnN0IGJhZGdlTGFiZWwgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVCYWRnZUxhYmVsID8/IFwidHlwXCI7XG4gICAgICBjb25zdCBzaG93U3VidHlwID1cbiAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlU3R5bGUgPT09IFwiZG90XCIgfHxcbiAgICAgICAgKGlzQmFkZ2UgJiYgdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlQmFkZ2VDb2xvcmVkICYmIGJhZGdlTGFiZWwgPT09IFwidHlwLXN1YnR5cFwiKTtcbiAgICAgIGlmICghaXNCYWRnZSAmJiAhc2hvd1N1YnR5cCkgcmV0dXJuO1xuXG4gICAgICAvLyBTdGFja3MgdGhlIGV4dHJhIHRvZ2dsZXMgaW5zdGVhZCBvZiBPYnNpZGlhbidzIHNpZGUtYnktc2lkZSBsYXlvdXQsXG4gICAgICAvLyBzZWUgLnR5cC1ub3RlLXRpdGxlLXNldHRpbmcgaW4gc3R5bGVzLmNzcy5cbiAgICAgIG5vdGVUaXRsZVNldHRpbmcuc2V0dGluZ0VsLmFkZENsYXNzKFwidHlwLW5vdGUtdGl0bGUtc2V0dGluZ1wiKTtcblxuICAgICAgLy8gQSBzbWFsbCBsYWJlbCBwZXIgdG9nZ2xlIC0gYWRkVG9nZ2xlKCkgYWxvbmUgYWRkcyBhIGJhcmUgc3dpdGNoLlxuICAgICAgY29uc3QgYWRkTGFiZWxlZFRvZ2dsZSA9IChsYWJlbCwgdG9vbHRpcCwgdmFsdWUsIG9uQ2hhbmdlKSA9PiB7XG4gICAgICAgIGNvbnN0IHJvdyA9IG5vdGVUaXRsZVNldHRpbmcuY29udHJvbEVsLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtbm90ZS10aXRsZS10b2dnbGUtcm93XCIgfSk7XG4gICAgICAgIHJvdy5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1ub3RlLXRpdGxlLXRvZ2dsZS1sYWJlbFwiLCB0ZXh0OiBsYWJlbCB9KTtcbiAgICAgICAgbmV3IFRvZ2dsZUNvbXBvbmVudChyb3cpLnNldFRvb2x0aXAodG9vbHRpcCkuc2V0VmFsdWUodmFsdWUpLm9uQ2hhbmdlKG9uQ2hhbmdlKTtcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGFkZFN1YnR5cFRvZ2dsZSA9IChsYWJlbCkgPT5cbiAgICAgICAgYWRkTGFiZWxlZFRvZ2dsZShcbiAgICAgICAgICBsYWJlbCxcbiAgICAgICAgICBcIlVzZSBTdWJ0eXAgY29sb3IgaW5zdGVhZCBvZiBUWVAgY29sb3JcIixcbiAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLm5vdGVUaXRsZU1hcmtlclN1YnR5cCxcbiAgICAgICAgICBhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3Mubm90ZVRpdGxlTWFya2VyU3VidHlwID0gdmFsdWU7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgICAgICAgIH1cbiAgICAgICAgKTtcblxuICAgICAgaWYgKCFpc0JhZGdlKSB7XG4gICAgICAgIGFkZFN1YnR5cFRvZ2dsZShcIlN1YnR5cFwiKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBsYWJlbFJvdyA9IG5vdGVUaXRsZVNldHRpbmcuY29udHJvbEVsLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtbm90ZS10aXRsZS10b2dnbGUtcm93XCIgfSk7XG4gICAgICBsYWJlbFJvdy5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1ub3RlLXRpdGxlLXRvZ2dsZS1sYWJlbFwiLCB0ZXh0OiBcIkxhYmVsXCIgfSk7XG4gICAgICBuZXcgRHJvcGRvd25Db21wb25lbnQobGFiZWxSb3cpXG4gICAgICAgIC5hZGRPcHRpb24oXCJ0eXBcIiwgXCJbVFlQXVwiKVxuICAgICAgICAuYWRkT3B0aW9uKFwidHlwLXN1YnR5cFwiLCBcIltUWVAvU3VidHlwXVwiKVxuICAgICAgICAuYWRkT3B0aW9uKFwic3VidHlwXCIsIFwiW1N1YnR5cF1cIilcbiAgICAgICAgLnNldFZhbHVlKGJhZGdlTGFiZWwpXG4gICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVCYWRnZUxhYmVsID0gdmFsdWU7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgICAgICAgdGhpcy5kaXNwbGF5KCk7XG4gICAgICAgIH0pO1xuXG4gICAgICBhZGRMYWJlbGVkVG9nZ2xlKFwiQ29sb3JlZFwiLCBcIkNvbG9yZWQgaW5zdGVhZCBvZiBuZXV0cmFsXCIsIHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZUJhZGdlQ29sb3JlZCwgYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZUJhZGdlQ29sb3JlZCA9IHZhbHVlO1xuICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgfSk7XG4gICAgICBpZiAoc2hvd1N1YnR5cCkgYWRkU3VidHlwVG9nZ2xlKFwiU3VidHlwIGNvbG9yXCIpO1xuXG4gICAgICBhZGRMYWJlbGVkVG9nZ2xlKFwiQXQgcHJvcGVydHkgYmxvY2tcIiwgXCJBdCB0aGUgcHJvcGVydHkgYmxvY2sgKHJvdGF0ZWQpIGluc3RlYWQgb2YgdGhlIHRpdGxlXCIsIGlzQmxvY2tQb3NpdGlvbiwgYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZUJhZGdlUG9zaXRpb24gPSB2YWx1ZSA/IFwiYmxvY2tcIiA6IFwidGl0bGVcIjtcbiAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgIH0pO1xuXG4gICAgICBpZiAoaXNCbG9ja1Bvc2l0aW9uKSB7XG4gICAgICAgIGFkZExhYmVsZWRUb2dnbGUoXG4gICAgICAgICAgXCJUb3AgaW5zdGVhZCBvZiBib3R0b21cIixcbiAgICAgICAgICBcIlRvcCBvZiB0aGUgcHJvcGVydHkgYmxvY2sgaW5zdGVhZCBvZiBib3R0b21cIixcbiAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVWZXJ0aWNhbEFsaWduID09PSBcInRvcFwiLFxuICAgICAgICAgIGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlVmVydGljYWxBbGlnbiA9IHZhbHVlID8gXCJ0b3BcIiA6IFwiYm90dG9tXCI7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgICAgICAgIH1cbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGNvbG9yVmlld1RvZ2dsZShcbiAgICAgIGNvbG9yaW5nR3JvdXAsXG4gICAgICBcImJhY2tsaW5rc1wiLFxuICAgICAgXCJCYWNrbGlua3NcIixcbiAgICAgIFwiQ29sb3IgcmVzdWx0cyBpbiB0aGUgYmFja2xpbmtzIHBhbmUgYW5kIGluIGVtYmVkZGVkIGJhY2tsaW5rcywgaW5jbHVkaW5nIHVubGlua2VkIG1lbnRpb25zLlwiLFxuICAgICAgXCJiYWNrbGlua3NTdWJ0eXBcIlxuICAgICk7XG4gICAgY29sb3JWaWV3VG9nZ2xlKGNvbG9yaW5nR3JvdXAsIFwiYm9va21hcmtzXCIsIFwiQm9va21hcmtzXCIsIFwiQ29sb3IgYm9va21hcmtzIHRoYXQgcG9pbnQgZGlyZWN0bHkgdG8gYSBub3RlLlwiLCBcImJvb2ttYXJrc1N1YnR5cFwiKTtcbiAgICBjb2xvclZpZXdUb2dnbGUoXG4gICAgICBjb2xvcmluZ0dyb3VwLFxuICAgICAgXCJhbGxQcm9wZXJ0aWVzXCIsXG4gICAgICBcIkFsbCBQcm9wZXJ0aWVzXCIsXG4gICAgICBcIkluIE9ic2lkaWFuJ3MgXFxcIkFsbCBwcm9wZXJ0aWVzXFxcIiB2aWV3LCBjb2xvciBwcm9wZXJ0eSBuYW1lcyB0aGF0IGJlbG9uZyB0byBleGFjdGx5IG9uZSBUWVAtRnJvbnRtYXR0ZXIsIG9yIGJvbGQgdGhlbSBpZiBtb3JlIHRoYW4gb25lIFRZUCB1c2VzIHRoZW0uIFdpdGggU3VidHlwLCBTdWJ0eXAgYmxvY2tzIGNvdW50IGFzIHdlbGwsIGluIHRoZSBTdWJ0eXAgY29sb3IuXCIsXG4gICAgICBcImFsbFByb3BlcnRpZXNTdWJ0eXBcIixcbiAgICAgIHsgdHlwVG9vbHRpcDogXCJUWVAtRnJvbnRtYXR0ZXJcIiwgc3VidHlwVG9vbHRpcDogXCJJbmNsdWRlIFN1YnR5cCBibG9ja3MsIGluIFN1YnR5cCBjb2xvclwiIH1cbiAgICApO1xuXG4gICAgLy8gTGltaXRzIG9mIHRoZSBzbGlkZXJzIGEgU3VidHlwIGRlcml2ZXMgaXRzIGNvbG9yIHdpdGggKGRvdCBhdCB0aGUgYm90dG9tXG4gICAgLy8gb2YgYSBTdWJ0eXAgYmxvY2ssIHNlZSB0eXAtY29sb3JzLmpzKS4gQSBsYXJnZXIgc3RvcmVkIG9mZnNldCBpcyBjbGFtcGVkXG4gICAgLy8gdG8gdGhlIG5ldyBsaW1pdC5cbiAgICBjb25zdCBzdWJ0eXBDb2xvckdyb3VwID0gbmV3IFNldHRpbmdHcm91cChjb250YWluZXJFbCkuc2V0SGVhZGluZyhcIlN1YnR5cCBjb2xvcnNcIik7XG4gICAgY29uc3QgcmFuZ2VNYXggPSB7IGg6IDE4MCwgLyogczogMTAwLCAqLyBsOiAxMDAgfTtcbiAgICBjb25zdCByYW5nZURlc2MgPSB7XG4gICAgICBoOiBcIk1heGltdW0gaHVlIGRpZmZlcmVuY2UgYmV0d2VlbiBhIFN1YnR5cCBhbmQgaXRzIFRZUC5cIixcbiAgICAgIC8vIHM6IFwiTWF4aW11bSBzaGFyZSBieSB3aGljaCBhIFN1YnR5cCBtYXkgYmUgcGFsZXIgdGhhbiBpdHMgVFlQLiBPbmx5IGdvZXMgZG93biAtIGEgU3VidHlwIHNob3VsZG4ndCBiZSBsb3VkZXIgdGhhbiBpdHMgVFlQLlwiLFxuICAgICAgbDogXCJNYXhpbXVtIGxpZ2h0bmVzcyBkaWZmZXJlbmNlIGJldHdlZW4gYSBTdWJ0eXAgYW5kIGl0cyBUWVAsIGFzIGEgc2hhcmUgb2YgdGhlIHdheSB0byB3aGl0ZSBvciBibGFjay5cIixcbiAgICB9O1xuICAgIC8vIFRoZSBzbGlkZXIgcmVwb3J0cyBldmVyeSBzdGVwOyB0aGUgb3RoZXIgdmlld3Mgb25seSBmb2xsb3cgb25jZSBpdCByZXN0cy5cbiAgICBjb25zdCByZWZyZXNoQ29sb3JzU29vbiA9IGRlYm91bmNlKCgpID0+IHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpLCAzMDAsIHRydWUpO1xuICAgIGZvciAoY29uc3QgeyBrZXksIGxhYmVsLCB1bml0LCBkb3duT25seSB9IG9mIFNVQlRZUF9DT0xPUl9DSEFOTkVMUykge1xuICAgICAgc3VidHlwQ29sb3JHcm91cC5hZGRTZXR0aW5nKChzZXR0aW5nKSA9PlxuICAgICAgICBzZXR0aW5nXG4gICAgICAgICAgLnNldE5hbWUoYCR7bGFiZWx9ICgke2Rvd25Pbmx5ID8gXCJcdTIyMTJcIiA6IFwiXHUwMEIxXCJ9ICR7dW5pdH0pYClcbiAgICAgICAgICAuc2V0RGVzYyhyYW5nZURlc2Nba2V5XSlcbiAgICAgICAgICAuYWRkU2xpZGVyKChzbGlkZXIpID0+XG4gICAgICAgICAgICBzbGlkZXJcbiAgICAgICAgICAgICAgLnNldExpbWl0cygwLCByYW5nZU1heFtrZXldLCAxKVxuICAgICAgICAgICAgICAuc2V0VmFsdWUoY29sb3JSYW5nZSh0aGlzLnBsdWdpbi5zZXR0aW5ncywga2V5KSlcbiAgICAgICAgICAgICAgLnNldER5bmFtaWNUb29sdGlwKClcbiAgICAgICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnN1YnR5cENvbG9yUmFuZ2VzID0geyAuLi5ERUZBVUxUX1NVQlRZUF9DT0xPUl9SQU5HRVMsIC4uLnRoaXMucGx1Z2luLnNldHRpbmdzLnN1YnR5cENvbG9yUmFuZ2VzLCBba2V5XTogdmFsdWUgfTtcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgICAgICByZWZyZXNoQ29sb3JzU29vbigpO1xuICAgICAgICAgICAgICB9KVxuICAgICAgICAgIClcbiAgICAgICAgICAuYWRkRXh0cmFCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgICAgIGJ1dHRvblxuICAgICAgICAgICAgICAuc2V0SWNvbihcInJvdGF0ZS1jY3dcIilcbiAgICAgICAgICAgICAgLnNldFRvb2x0aXAoYFJlc2V0IHRvICR7REVGQVVMVF9TVUJUWVBfQ09MT1JfUkFOR0VTW2tleV19YClcbiAgICAgICAgICAgICAgLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnN1YnR5cENvbG9yUmFuZ2VzID0geyAuLi5ERUZBVUxUX1NVQlRZUF9DT0xPUl9SQU5HRVMsIC4uLnRoaXMucGx1Z2luLnNldHRpbmdzLnN1YnR5cENvbG9yUmFuZ2VzLCBba2V5XTogREVGQVVMVF9TVUJUWVBfQ09MT1JfUkFOR0VTW2tleV0gfTtcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbiAgICAgICAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgICAgICAgICAgfSlcbiAgICAgICAgICApXG4gICAgICApO1xuICAgIH1cblxuICAgIC8vIEdyb3VwIFwiR3JhcGhcIiAodGFnL2F0dGFjaG1lbnQgY29sb3JzKSBkaXNhYmxlZCAoMjAyNi0wOS0zMCk6IHRoZSBNaW5pbWFsXG4gICAgLy8gdGhlbWUncyBTdHlsZSBTZXR0aW5ncyBjb3ZlciBib3RoLCBzZWUgZ3JhcGgtY29sb3JzLmpzLiBDb2xvcmluZyBub3RlXG4gICAgLy8gbm9kZXMgYnkgVFlQIHN0YXlzLCB1bmRlciBcIkNvbG9yaW5nXCIgXHUyMTkyIFwiR3JhcGhcIi5cbiAgICAvLyAgICAgY29uc3QgZ3JhcGhHcm91cCA9IG5ldyBTZXR0aW5nR3JvdXAoY29udGFpbmVyRWwpLnNldEhlYWRpbmcoXCJHcmFwaFwiKTtcbiAgICAvL1xuICAgIC8vICAgICAvLyBPbmUgc2V0dGluZyBwZXIgbm9kZSBraW5kIHRoZSBncmFwaCBlbmdpbmUga25vd3MsIHNhbWUgbGF5b3V0XG4gICAgLy8gICAgIC8vICh0b2dnbGUgKyBjb2xvciBwaWNrZXIgKyByZXNldCkgZm9yIGVhY2guXG4gICAgLy8gICAgIGNvbnN0IGdyYXBoQ29sb3JTZXR0aW5nID0gKGVuYWJsZWRLZXksIGNvbG9yS2V5LCBkZWZhdWx0Q29sb3IsIG5hbWUsIGRlc2MpID0+XG4gICAgLy8gICAgICAgZ3JhcGhHcm91cC5hZGRTZXR0aW5nKChzZXR0aW5nKSA9PlxuICAgIC8vICAgICAgICAgc2V0dGluZ1xuICAgIC8vICAgICAgICAgICAuc2V0TmFtZShuYW1lKVxuICAgIC8vICAgICAgICAgICAuc2V0RGVzYyhkZXNjKVxuICAgIC8vICAgICAgICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgLy8gICAgICAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzW2VuYWJsZWRLZXldKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAvLyAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzW2VuYWJsZWRLZXldID0gdmFsdWU7XG4gICAgLy8gICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAvLyAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgIC8vICAgICAgICAgICAgIH0pXG4gICAgLy8gICAgICAgICAgIClcbiAgICAvLyAgICAgICAgICAgLmFkZENvbG9yUGlja2VyKChwaWNrZXIpID0+XG4gICAgLy8gICAgICAgICAgICAgcGlja2VyLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzW2NvbG9yS2V5XSB8fCBkZWZhdWx0Q29sb3IpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgIC8vICAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3NbY29sb3JLZXldID0gdmFsdWU7XG4gICAgLy8gICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAvLyAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgIC8vICAgICAgICAgICAgIH0pXG4gICAgLy8gICAgICAgICAgIClcbiAgICAvLyAgICAgICAgICAgLmFkZEV4dHJhQnV0dG9uKChidXR0b24pID0+XG4gICAgLy8gICAgICAgICAgICAgYnV0dG9uXG4gICAgLy8gICAgICAgICAgICAgICAuc2V0SWNvbihcInJvdGF0ZS1jY3dcIilcbiAgICAvLyAgICAgICAgICAgICAgIC5zZXRUb29sdGlwKFwiUmVzZXQgdG8gZGVmYXVsdCBjb2xvclwiKVxuICAgIC8vICAgICAgICAgICAgICAgLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgIC8vICAgICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5nc1tjb2xvcktleV0gPSBcIlwiO1xuICAgIC8vICAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAvLyAgICAgICAgICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgLy8gICAgICAgICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgIC8vICAgICAgICAgICAgICAgfSlcbiAgICAvLyAgICAgICAgICAgKVxuICAgIC8vICAgICAgICk7XG4gICAgLy9cbiAgICAvLyAgICAgZ3JhcGhDb2xvclNldHRpbmcoXG4gICAgLy8gICAgICAgXCJncmFwaFRhZ0NvbG9yRW5hYmxlZFwiLFxuICAgIC8vICAgICAgIFwiZ3JhcGhUYWdDb2xvclwiLFxuICAgIC8vICAgICAgIFwiIzg4ODg4OFwiLFxuICAgIC8vICAgICAgIFwiVGFnIGNvbG9yXCIsXG4gICAgLy8gICAgICAgXCJPd24gY29sb3IgZm9yIHRhZyBub2RlcyBpbiB0aGUgZ2xvYmFsIGFuZCBsb2NhbCBncmFwaC4gQ29sb3IgZ3JvdXBzIHN0aWxsIHRha2UgcHJlY2VkZW5jZS5cIlxuICAgIC8vICAgICApO1xuICAgIC8vICAgICBncmFwaENvbG9yU2V0dGluZyhcbiAgICAvLyAgICAgICBcImdyYXBoQXR0YWNobWVudENvbG9yRW5hYmxlZFwiLFxuICAgIC8vICAgICAgIFwiZ3JhcGhBdHRhY2htZW50Q29sb3JcIixcbiAgICAvLyAgICAgICBcIiNlMGFjMDBcIixcbiAgICAvLyAgICAgICBcIkF0dGFjaG1lbnQgY29sb3JcIixcbiAgICAvLyAgICAgICBcIk93biBjb2xvciBmb3IgYXR0YWNobWVudCBub2RlcyAobm9uLW1hcmtkb3duIGZpbGVzIHN1Y2ggYXMgaW1hZ2VzIG9yIFBERnMpIGluIHRoZSBncmFwaC5cIlxuICAgIC8vICAgICApO1xuXG4gICAgY29uc3QgZnJvbnRtYXR0ZXJHcm91cCA9IG5ldyBTZXR0aW5nR3JvdXAoY29udGFpbmVyRWwpLnNldEhlYWRpbmcoXCJUWVAtRnJvbnRtYXR0ZXJcIik7XG5cbiAgICBjb2xvclZpZXdUb2dnbGUoXG4gICAgICBmcm9udG1hdHRlckdyb3VwLFxuICAgICAgXCJmcm9udG1hdHRlckRlZmF1bHRzXCIsXG4gICAgICBcIkJvbGQgVFlQIHByb3BlcnRpZXNcIixcbiAgICAgIFwiU2hvdyBUWVAtRnJvbnRtYXR0ZXIgcHJvcGVydHkgbmFtZXMgaW4gYm9sZCBpbiBub3RlcyBhbmQgdGhlIHByb3BlcnRpZXMgc2lkZWJhci4gV2l0aCBTdWJ0eXAsIHRoZSBub3RlJ3MgU3VidHlwIGJsb2NrIGNvdW50cyBhcyB3ZWxsLlwiLFxuICAgICAgXCJmcm9udG1hdHRlckRlZmF1bHRzU3VidHlwXCIsXG4gICAgICB7IHR5cFRvb2x0aXA6IFwiVFlQLUZyb250bWF0dGVyXCIsIHN1YnR5cFRvb2x0aXA6IFwiSW5jbHVkZSBTdWJ0eXAgYmxvY2tzXCIgfVxuICAgICk7XG5cbiAgICAvLyBUaGUgb3JkZXIgZWRpdG9yIGJyaW5ncyBpdHMgb3duIGhlYWRpbmcgYW5kIGJ1dHRvbnMsIHNvIGl0IGdvZXMgc3RyYWlnaHRcbiAgICAvLyBpbnRvIGluZm9FbCBpbnN0ZWFkIG9mIHNldE5hbWUvc2V0RGVzYyAoc2VlIC50eXAtb3JkZXItc2V0dGluZykuXG4gICAgZnJvbnRtYXR0ZXJHcm91cC5hZGRTZXR0aW5nKChzZXR0aW5nKSA9PiB7XG4gICAgICBzZXR0aW5nLnNldHRpbmdFbC5hZGRDbGFzcyhcInR5cC1vcmRlci1zZXR0aW5nXCIpO1xuICAgICAgbW91bnRHbG9iYWxPcmRlckVkaXRvcihzZXR0aW5nLmluZm9FbCwgdGhpcy5wbHVnaW4pO1xuICAgICAgc2V0dGluZy5pbmZvRWwuY3JlYXRlRGl2KHtcbiAgICAgICAgY2xzOiBcInNldHRpbmctaXRlbS1kZXNjcmlwdGlvblwiLFxuICAgICAgICB0ZXh0OlxuICAgICAgICAgICdPcmRlciBhcHBsaWVkIGJ5IHRoZSBcIlNvcnQgZnJvbnRtYXR0ZXJcIiBjb21tYW5kczsgdmFsdWVzIGFyZSBuZXZlciBjaGFuZ2VkLiBQaW4gc2luZ2xlIHByb3BlcnRpZXMgc3VjaCBhcyBjc3NjbGFzc2VzIG9yIGFsaWFzZXMuIERyYWcgdG8gcmVvcmRlcjsgaG92ZXIgYSBwbGFjZWhvbGRlciByb3cgZm9yIHdoYXQgaXQgc3RhbmRzIGZvci4gUGxhY2Vob2xkZXIgcm93cyBjYW5cXCd0IGJlIHJlbW92ZWQuJyxcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgY29udGFpbmVyRWwuc2Nyb2xsVG9wID0gc2Nyb2xsVG9wO1xuICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyBERUZBVUxUX1NFVFRJTkdTLCBUeXBTeXN0ZW1TZXR0aW5nVGFiIH07XG4iLCAiY29uc3QgeyBNb2RhbCwgU2V0dGluZyB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyBwbHVyYWwgfSA9IHJlcXVpcmUoXCIuL3R5cC11dGlsc1wiKTtcblxuLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gKiBUaGUgdHdvIGRpYWxvZ3Mgb2YgdGhlIEJhc2UgY29tbWFuZHMgKHNlZSBiYXNlcy5qcyk6XG4gKiAgLSBjb2x1bW4gb3B0aW9ucyBiZWZvcmUgY3JlYXRpbmcvdXBkYXRpbmdcbiAqICAtIGNvbmZpcm1pbmcgcmVtb3ZhbHMgd2hlbiB1cGRhdGluZ1xuICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovXG5cbmNvbnN0IE5PVEVfUFJFRklYID0gXCJub3RlLlwiO1xuXG4vLyBDb2x1bW4gbGFiZWw6IHRoZSBzaG9ydCBmb3JtIHRoZSBwcm9wZXJ0eSBoYXMgaW4gdGhlIC5iYXNlIGZpbGVcbi8vIChcIlRpdGVsXCIgaW5zdGVhZCBvZiBcIm5vdGUuVGl0ZWxcIikuXG5mdW5jdGlvbiBjb2x1bW5MYWJlbChpZCkge1xuICByZXR1cm4gaWQuc3RhcnRzV2l0aChOT1RFX1BSRUZJWCkgPyBpZC5zbGljZShOT1RFX1BSRUZJWC5sZW5ndGgpIDogaWQ7XG59XG5cbmZ1bmN0aW9uIHRhcmdldExhYmVsKHRhcmdldCkge1xuICBpZiAoIXRhcmdldC50eXApIHJldHVybiBgU3VidHlwICR7dGFyZ2V0LnN1YnR5cH1gO1xuICByZXR1cm4gdGFyZ2V0LnN1YnR5cCA/IGAke3RhcmdldC50eXB9IC8gJHt0YXJnZXQuc3VidHlwfWAgOiBgVFlQICR7dGFyZ2V0LnR5cH1gO1xufVxuXG4vKiAtLS0gQ29sdW1uIG9wdGlvbnMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tICovXG5cbi8vIFRocmVlIHRvZ2dsZXMsIGFsbCBvZmYgYnkgZGVmYXVsdCAoZmlsZS5uYW1lIHBsdXMgVFlQLUZyb250bWF0dGVyIGlzIHRoZVxuLy8gbm9ybWFsIGNhc2UpLCB3aXRoIGEgbGl2ZSBwcmV2aWV3IG9mIHRoZSByZXN1bHRpbmcgY29sdW1ucyBzbyBhIHRvZ2dsZSdzXG4vLyBlZmZlY3QgbmVlZG4ndCBiZSBndWVzc2VkLiBcIkFsbCBTdWJ0eXAgcHJvcGVydGllc1wiIG9ubHkgc2hvd3MgZm9yIGEgVFlQXG4vLyB0YXJnZXQ6IGluIGEgU3VidHlwIHZpZXcgdGhlIG90aGVyIFN1YnR5cCBibG9ja3Mgd291bGQgc3RheSBlbXB0eS5cbmNsYXNzIENvbHVtbk9wdGlvbnNNb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgY29uc3RydWN0b3IocGx1Z2luLCB0YXJnZXQsIHByZXZpZXcsIHJlc29sdmUpIHtcbiAgICBzdXBlcihwbHVnaW4uYXBwKTtcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgICB0aGlzLnRhcmdldCA9IHRhcmdldDtcbiAgICB0aGlzLnByZXZpZXcgPSBwcmV2aWV3O1xuICAgIHRoaXMucmVzb2x2ZSA9IHJlc29sdmU7XG4gICAgdGhpcy5vcHRpb25zID0geyBmbG9hdGluZzogZmFsc2UsIGFsbFN1YnR5cHM6IGZhbHNlLCB0YWdzOiBmYWxzZSB9O1xuICAgIHRoaXMuY29uZmlybWVkID0gZmFsc2U7XG4gIH1cblxuICBvbk9wZW4oKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgdGhpcy5tb2RhbEVsLmFkZENsYXNzKFwidHlwLWJhc2Utb3B0aW9ucy1tb2RhbFwiKTtcbiAgICB0aGlzLnRpdGxlRWwuc2V0VGV4dChgQ29sdW1ucyBmb3IgJHt0YXJnZXRMYWJlbCh0aGlzLnRhcmdldCl9YCk7XG5cbiAgICBjb25zdCB0b2dnbGUgPSAobmFtZSwgZGVzY3JpcHRpb24sIGtleSkgPT4ge1xuICAgICAgbmV3IFNldHRpbmcoY29udGVudEVsKVxuICAgICAgICAuc2V0TmFtZShuYW1lKVxuICAgICAgICAuc2V0RGVzYyhkZXNjcmlwdGlvbilcbiAgICAgICAgLmFkZFRvZ2dsZSgoY29udHJvbCkgPT5cbiAgICAgICAgICBjb250cm9sLnNldFZhbHVlKHRoaXMub3B0aW9uc1trZXldKS5vbkNoYW5nZSgodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMub3B0aW9uc1trZXldID0gdmFsdWU7XG4gICAgICAgICAgICB0aGlzLnJlbmRlclByZXZpZXcoKTtcbiAgICAgICAgICB9KVxuICAgICAgICApO1xuICAgIH07XG5cbiAgICB0b2dnbGUoXCJGbG9hdGluZyBwcm9wZXJ0aWVzXCIsIFwiSW5jbHVkZSB0aGUgYmxvY2sncyBmbG9hdGluZyAoaXRhbGljKSBwcm9wZXJ0aWVzLlwiLCBcImZsb2F0aW5nXCIpO1xuICAgIGlmICghdGhpcy50YXJnZXQuc3VidHlwKSB7XG4gICAgICB0b2dnbGUoXCJBbGwgU3VidHlwIHByb3BlcnRpZXNcIiwgXCJBbHNvIGluY2x1ZGUgdGhlIHByb3BlcnRpZXMgb2YgZXZlcnkgU3VidHlwIGJsb2NrIG9mIHRoaXMgVFlQLlwiLCBcImFsbFN1YnR5cHNcIik7XG4gICAgfVxuICAgIHRvZ2dsZShcInRhZ3NcIiwgXCJBZGQgdGhlIHRhZ3MgcHJvcGVydHkgYXMgYSBjb2x1bW4uXCIsIFwidGFnc1wiKTtcblxuICAgIHRoaXMucHJldmlld0VsID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtYmFzZS1wcmV2aWV3XCIgfSk7XG4gICAgdGhpcy5yZW5kZXJQcmV2aWV3KCk7XG5cbiAgICBjb25zdCBidXR0b25Sb3cgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcIm1vZGFsLWJ1dHRvbi1jb250YWluZXJcIiB9KTtcbiAgICBidXR0b25Sb3cuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIkNhbmNlbFwiIH0pLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmNsb3NlKCkpO1xuICAgIGNvbnN0IGNvbmZpcm0gPSBidXR0b25Sb3cuY3JlYXRlRWwoXCJidXR0b25cIiwgeyBjbHM6IFwibW9kLWN0YVwiLCB0ZXh0OiBcIkFwcGx5XCIgfSk7XG4gICAgY29uZmlybS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgICAgdGhpcy5jb25maXJtZWQgPSB0cnVlO1xuICAgICAgdGhpcy5jbG9zZSgpO1xuICAgIH0pO1xuICB9XG5cbiAgcmVuZGVyUHJldmlldygpIHtcbiAgICBjb25zdCBpZHMgPSB0aGlzLnByZXZpZXcodGhpcy5vcHRpb25zKTtcbiAgICB0aGlzLnByZXZpZXdFbC5lbXB0eSgpO1xuICAgIHRoaXMucHJldmlld0VsLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtYmFzZS1wcmV2aWV3LXRpdGxlXCIsIHRleHQ6IHBsdXJhbChpZHMubGVuZ3RoLCBcImNvbHVtblwiKSB9KTtcbiAgICBjb25zdCBsaXN0ID0gdGhpcy5wcmV2aWV3RWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1iYXNlLXByZXZpZXctbGlzdFwiIH0pO1xuICAgIGZvciAoY29uc3QgaWQgb2YgaWRzKSBsaXN0LmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLWJhc2UtcHJldmlldy1jb2x1bW5cIiwgdGV4dDogY29sdW1uTGFiZWwoaWQpIH0pO1xuICB9XG5cbiAgb25DbG9zZSgpIHtcbiAgICB0aGlzLmNvbnRlbnRFbC5lbXB0eSgpO1xuICAgIC8vIEVTQyBvciBhIGNsaWNrIG91dHNpZGUgY291bnRzIGFzIGNhbmNlbC5cbiAgICB0aGlzLnJlc29sdmUodGhpcy5jb25maXJtZWQgPyB0aGlzLm9wdGlvbnMgOiBudWxsKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBhc2tDb2x1bW5PcHRpb25zKHBsdWdpbiwgdGFyZ2V0LCBwcmV2aWV3KSB7XG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gbmV3IENvbHVtbk9wdGlvbnNNb2RhbChwbHVnaW4sIHRhcmdldCwgcHJldmlldywgcmVzb2x2ZSkub3BlbigpKTtcbn1cblxuLyogLS0tIENvbmZpcm0gcmVtb3ZhbHMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSAqL1xuXG4vLyBBZGRpbmcgYW5kIHJlb3JkZXJpbmcgY29sdW1ucyBoYXBwZW4gc2lsZW50bHk7IG9ubHkgcmVtb3ZpbmcgaXMgc2hvd24sXG4vLyBiZWNhdXNlIG9ubHkgdGhhdCBsb3NlcyBzb21ldGhpbmcuIEV2ZXJ5IGVudHJ5IHN0YXJ0cyBjaGVja2VkOyBhbiB1bmNoZWNrZWRcbi8vIGNvbHVtbiBpcyBrZXB0IChhdCB0aGUgZnJvbnQsIHNlZSB1cGRhdGVBY3RpdmVWaWV3KS5cbmNsYXNzIFJlbW92YWxNb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgY29uc3RydWN0b3IocGx1Z2luLCBjb2x1bW5zLCB2aWV3TmFtZSwgcmVzb2x2ZSkge1xuICAgIHN1cGVyKHBsdWdpbi5hcHApO1xuICAgIHRoaXMuY29sdW1ucyA9IGNvbHVtbnM7XG4gICAgdGhpcy52aWV3TmFtZSA9IHZpZXdOYW1lO1xuICAgIHRoaXMucmVzb2x2ZSA9IHJlc29sdmU7XG4gICAgdGhpcy5tYXJrZWQgPSBuZXcgU2V0KGNvbHVtbnMpO1xuICAgIHRoaXMuY29uZmlybWVkID0gZmFsc2U7XG4gIH1cblxuICBvbk9wZW4oKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgdGhpcy5tb2RhbEVsLmFkZENsYXNzKFwidHlwLWJhc2UtcmVtb3ZhbC1tb2RhbFwiKTtcbiAgICB0aGlzLnRpdGxlRWwuc2V0VGV4dChgUmVtb3ZlIGNvbHVtbnMgZnJvbSBcIiR7dGhpcy52aWV3TmFtZX1cImApO1xuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgY2xzOiBcInR5cC1iYXNlLXJlbW92YWwtaW50cm9cIixcbiAgICAgIHRleHQ6IFwiVGhlc2UgY29sdW1ucyBkb24ndCBiZWxvbmcgdG8gdGhlIFRZUC4gVW5jaGVja2VkIG9uZXMgYXJlIGtlcHQuXCIsXG4gICAgfSk7XG5cbiAgICBmb3IgKGNvbnN0IGlkIG9mIHRoaXMuY29sdW1ucykge1xuICAgICAgbmV3IFNldHRpbmcoY29udGVudEVsKS5zZXROYW1lKGNvbHVtbkxhYmVsKGlkKSkuYWRkVG9nZ2xlKChjb250cm9sKSA9PlxuICAgICAgICBjb250cm9sLnNldFZhbHVlKHRydWUpLm9uQ2hhbmdlKCh2YWx1ZSkgPT4ge1xuICAgICAgICAgIGlmICh2YWx1ZSkgdGhpcy5tYXJrZWQuYWRkKGlkKTtcbiAgICAgICAgICBlbHNlIHRoaXMubWFya2VkLmRlbGV0ZShpZCk7XG4gICAgICAgIH0pXG4gICAgICApO1xuICAgIH1cblxuICAgIGNvbnN0IGJ1dHRvblJvdyA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IFwibW9kYWwtYnV0dG9uLWNvbnRhaW5lclwiIH0pO1xuICAgIGJ1dHRvblJvdy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IHRleHQ6IFwiQ2FuY2VsXCIgfSkuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuY2xvc2UoKSk7XG4gICAgY29uc3QgY29uZmlybSA9IGJ1dHRvblJvdy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IGNsczogXCJtb2QtY3RhXCIsIHRleHQ6IFwiQXBwbHlcIiB9KTtcbiAgICBjb25maXJtLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XG4gICAgICB0aGlzLmNvbmZpcm1lZCA9IHRydWU7XG4gICAgICB0aGlzLmNsb3NlKCk7XG4gICAgfSk7XG4gIH1cblxuICBvbkNsb3NlKCkge1xuICAgIHRoaXMuY29udGVudEVsLmVtcHR5KCk7XG4gICAgdGhpcy5yZXNvbHZlKHRoaXMuY29uZmlybWVkID8gdGhpcy5tYXJrZWQgOiBudWxsKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBhc2tSZW1vdmFscyhwbHVnaW4sIGNvbHVtbnMsIHZpZXdOYW1lKSB7XG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gbmV3IFJlbW92YWxNb2RhbChwbHVnaW4sIGNvbHVtbnMsIHZpZXdOYW1lLCByZXNvbHZlKS5vcGVuKCkpO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgYXNrQ29sdW1uT3B0aW9ucywgYXNrUmVtb3ZhbHMgfTtcbiIsICJjb25zdCB7IE5vdGljZSwgVEZpbGUsIHN0cmluZ2lmeVlhbWwgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgZ2V0U3VidHlwTmFtZXMgfSA9IHJlcXVpcmUoXCIuL3N1YnR5cHNcIik7XG5jb25zdCB7IG5vcm1hbGl6ZUdsb2JhbE9yZGVyLCBUWVBfUFJPUEVSVFksIFNVQlRZUF9QUk9QRVJUWSB9ID0gcmVxdWlyZShcIi4vZnJvbnRtYXR0ZXItc29ydFwiKTtcbmNvbnN0IHsgYXNrQ29sdW1uT3B0aW9ucywgYXNrUmVtb3ZhbHMgfSA9IHJlcXVpcmUoXCIuL2Jhc2UtZGlhbG9nc1wiKTtcbmNvbnN0IHsgcGx1cmFsIH0gPSByZXF1aXJlKFwiLi90eXAtdXRpbHNcIik7XG5cbi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICogQmFzZXMgZnJvbSBhIFRZUFxuICogQ3JlYXRlcyBhIC5iYXNlIGluIHRoZSB2YXVsdCByb290IGZvciBhIFRZUCAob3IgYSBTdWJ0eXAgbmFtZSk6XG4gKiBhIFRZUCBmaWx0ZXIsIG9uZSB0YWJsZSB2aWV3IHBlciBTdWJ0eXAsIGFuZCBjb2x1bW5zIGZyb20gdGhlXG4gKiBUWVAtRnJvbnRtYXR0ZXIgcGx1cyB0aGUgZ2xvYmFsIHByb3BlcnR5IG9yZGVyLiBUaGUgc2Vjb25kXG4gKiBjb21tYW5kIGJyaW5ncyB0aGUgY29sdW1ucyBvZiBhbiBleGlzdGluZyB2aWV3IHVwIHRvIGRhdGUuXG4gKlxuICogV3JpdGVzIG9ubHkgdGhyb3VnaCBPYnNpZGlhbidzIG93biBCYXNlcyBBUEkgYW5kIHNlcmlhbGl6YXRpb25cbiAqIChzZWUgYXBwZW5kVmlld3MpLCBuZXZlciB0aHJvdWdoIHNlbGYtcGFyc2VkIFlBTUwgLSBmb3JtdWxhXG4gKiBibG9ja3MgYW5kIHNwZWNpYWwga2V5cyB3b3VsZG4ndCByZWxpYWJseSBzdXJ2aXZlIHRoZSByb3VuZCB0cmlwLlxuICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovXG5cbi8vIFZpZXcgcHJvcGVydHkgaWRzIGFyZSBmdWxseSBxdWFsaWZpZWQgaW4gbWVtb3J5IChcIm5vdGUuVGl0ZWxcIiwgXCJmaWxlLm5hbWVcIixcbi8vIFwiZm9ybXVsYS5YXCIpIGJ1dCBzdG9yZWQgd2l0aG91dCBcIm5vdGUuXCIgaW4gdGhlIGZpbGUuIGNmZy5zZXRPcmRlcigpIHdhbnRzXG4vLyB0aGUgcXVhbGlmaWVkIGZvcm0sIGEgdmlldyBvYmplY3QgYnVpbHQgZm9yIHRoZSBmaWxlIHRoZSBzaG9ydCBvbmUgLVxuLy8gc2VyaWFsaXplSWQoKSBjb252ZXJ0cy5cbmNvbnN0IEZJTEVfTkFNRV9JRCA9IFwiZmlsZS5uYW1lXCI7XG5jb25zdCBOT1RFX1BSRUZJWCA9IFwibm90ZS5cIjtcbmNvbnN0IFRBR1NfUFJPUEVSVFkgPSBcInRhZ3NcIjtcbmNvbnN0IEJBU0VfRVhURU5TSU9OID0gXCJiYXNlXCI7XG4vLyBJZCBvZiB0aGUgQmFzZXMgY29yZSBwbHVnaW4gKGFzIGluIC5vYnNpZGlhbi9jb3JlLXBsdWdpbnMuanNvbikuXG5jb25zdCBCQVNFU19QTFVHSU5fSUQgPSBcImJhc2VzXCI7XG5cbi8vIFdpdGhvdXQgdGhlIEJhc2VzIGNvcmUgcGx1Z2luIGEgLmJhc2UgZmlsZSBjYW4ndCBiZSBvcGVuZWQsIHNvIGNyZWF0aW5nIG9uZVxuLy8gd291bGQgb25seSBsZWF2ZSBhIGRlYWQgZmlsZSBiZWhpbmQgKHNlZSBcImNyZWF0ZS1iYXNlLWZvci10eXBcIiBpblxuLy8gY29tbWFuZHMuanMpLlxuZnVuY3Rpb24gaXNCYXNlc0VuYWJsZWQoYXBwKSB7XG4gIHJldHVybiAhIWFwcC5pbnRlcm5hbFBsdWdpbnM/LmdldEVuYWJsZWRQbHVnaW5CeUlkPy4oQkFTRVNfUExVR0lOX0lEKTtcbn1cblxuZnVuY3Rpb24gbm90ZUlkKGtleSkge1xuICByZXR1cm4gTk9URV9QUkVGSVggKyBrZXk7XG59XG5cbmZ1bmN0aW9uIHNlcmlhbGl6ZUlkKGlkKSB7XG4gIHJldHVybiBpZC5zdGFydHNXaXRoKE5PVEVfUFJFRklYKSA/IGlkLnNsaWNlKE5PVEVfUFJFRklYLmxlbmd0aCkgOiBpZDtcbn1cblxuZnVuY3Rpb24gc2FtZUlkKGEsIGIpIHtcbiAgcmV0dXJuIGEudG9Mb3dlckNhc2UoKSA9PT0gYi50b0xvd2VyQ2FzZSgpO1xufVxuXG4vLyBBIGZpbHRlciBleHByZXNzaW9uIHRoZSB3YXkgQmFzZXMgd3JpdGVzIGl0OiBUWVAgPT0gXCJNRURJQVwiLiBKU09OLnN0cmluZ2lmeVxuLy8gcXVvdGVzIGNvcnJlY3RseSBldmVuIGlmIHRoZSBuYW1lIGNvbnRhaW5zIGEgcXVvdGUuXG5mdW5jdGlvbiBlcXVhbHNGaWx0ZXIocHJvcGVydHksIHZhbHVlKSB7XG4gIHJldHVybiBgJHtwcm9wZXJ0eX0gPT0gJHtKU09OLnN0cmluZ2lmeShTdHJpbmcodmFsdWUpKX1gO1xufVxuXG4vKiAtLS0gUmVhZGluZyBUWVAvU3VidHlwIGZyb20gYW4gZXhpc3RpbmcgZmlsdGVyIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gKiBBIGdlbmVyYXRlZCB2aWV3IGNhcnJpZXMgaXRzIFRZUCBpbiB0aGUgcm9vdCBvciB2aWV3IGZpbHRlcjsgdGhlIHVwZGF0ZVxuICogY29tbWFuZCByZWFkcyBpdCBmcm9tIHRoZXJlIGluc3RlYWQgb2YgYXNraW5nLiBPbmx5IHVuYW1iaWd1b3VzIGZpbHRlcnNcbiAqIGNvdW50OiBhIHB1cmUgQU5EIHdpdGggZXhhY3RseSBvbmUgVFlQIG9yIFNVQlRZUCBjb21wYXJpc29uLiBBbiBPUiBncm91cFxuICogZG9lc24ndCBuZWNlc3NhcmlseSByZXN0cmljdCwgYW5kIGEgc2Vjb25kLCBkaWZmZXJlbnQgdmFsdWUgY29udHJhZGljdHMgLVxuICogYm90aCBnaXZlIG51bGwgYW5kIHRoZSBjb21tYW5kIGFza3MgaW5zdGVhZCAoc2VlIHVwZGF0ZUFjdGl2ZVZpZXcpLlxuICogLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tICovXG5jb25zdCBFUVVBTFNfUEFUVEVSTiA9IG5ldyBSZWdFeHAoYF5cXFxccyooJHtUWVBfUFJPUEVSVFl9fCR7U1VCVFlQX1BST1BFUlRZfSlcXFxccyo9PVxcXFxzKiguKz8pXFxcXHMqJGAsIFwiaVwiKTtcblxuZnVuY3Rpb24gZmlsdGVyTGl0ZXJhbChyYXcpIHtcbiAgaWYgKHJhdy5sZW5ndGggPj0gMiAmJiByYXdbMF0gPT09ICdcIicgJiYgcmF3LmVuZHNXaXRoKCdcIicpKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBKU09OLnBhcnNlKHJhdyk7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gIH1cbiAgaWYgKHJhdy5sZW5ndGggPj0gMiAmJiByYXdbMF0gPT09IFwiJ1wiICYmIHJhdy5lbmRzV2l0aChcIidcIikpIHJldHVybiByYXcuc2xpY2UoMSwgLTEpO1xuICByZXR1cm4gbnVsbDtcbn1cblxuZnVuY3Rpb24gY29sbGVjdEVxdWFscyhub2RlLCBmb3VuZCkge1xuICBpZiAoIW5vZGUpIHJldHVybjtcbiAgaWYgKHR5cGVvZiBub2RlID09PSBcInN0cmluZ1wiKSB7XG4gICAgY29uc3QgbWF0Y2ggPSBFUVVBTFNfUEFUVEVSTi5leGVjKG5vZGUpO1xuICAgIGlmICghbWF0Y2gpIHJldHVybjtcbiAgICBjb25zdCB2YWx1ZSA9IGZpbHRlckxpdGVyYWwobWF0Y2hbMl0pO1xuICAgIGlmICh2YWx1ZSAhPT0gbnVsbCkgZm91bmRbbWF0Y2hbMV0udG9VcHBlckNhc2UoKV0uYWRkKHZhbHVlKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKEFycmF5LmlzQXJyYXkobm9kZSkpIHtcbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIG5vZGUpIGNvbGxlY3RFcXVhbHMoZW50cnksIGZvdW5kKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gQU5EIG9ubHk6IGFuIE9SL05PVCBncm91cCBzYXlzIG5vdGhpbmcgcmVsaWFibGUgYWJvdXQgdGhlIFRZUCBvZiB0aGUgaGl0cy5cbiAgaWYgKG5vZGUuYW5kKSBjb2xsZWN0RXF1YWxzKG5vZGUuYW5kLCBmb3VuZCk7XG59XG5cbmZ1bmN0aW9uIHJlYWRUYXJnZXQoLi4uZmlsdGVyR3JvdXBzKSB7XG4gIGNvbnN0IGZvdW5kID0geyBbVFlQX1BST1BFUlRZXTogbmV3IFNldCgpLCBbU1VCVFlQX1BST1BFUlRZXTogbmV3IFNldCgpIH07XG4gIGZvciAoY29uc3QgZ3JvdXAgb2YgZmlsdGVyR3JvdXBzKSBjb2xsZWN0RXF1YWxzKGdyb3VwLCBmb3VuZCk7XG4gIGNvbnN0IHR5cHMgPSBbLi4uZm91bmRbVFlQX1BST1BFUlRZXV07XG4gIGNvbnN0IHN1YnR5cHMgPSBbLi4uZm91bmRbU1VCVFlQX1BST1BFUlRZXV07XG4gIGlmICh0eXBzLmxlbmd0aCA+IDEgfHwgc3VidHlwcy5sZW5ndGggPiAxKSByZXR1cm4gbnVsbDtcbiAgaWYgKHR5cHMubGVuZ3RoID09PSAwICYmIHN1YnR5cHMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIHsgdHlwOiB0eXBzWzBdID8/IG51bGwsIHN1YnR5cDogc3VidHlwc1swXSA/PyBudWxsIH07XG59XG5cbi8qIC0tLSBDb2x1bW5zIG9mIGEgdGFyZ2V0IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gKi9cblxuLy8gVFlQIGFuZCBTVUJUWVAgbmV2ZXIgYmVjb21lIGNvbHVtbnMgKGZpbHRlciBhbmQgZ3JvdXBpbmcgYWxyZWFkeSBzaG93XG4vLyB0aGVtKSwgbm9yIGRvZXMgdGhlIGVkaXRvcidzIGJsYW5rIHJvdy5cbmZ1bmN0aW9uIGlzU3lzdGVtS2V5KGtleSkge1xuICByZXR1cm4ga2V5ID09PSBcIlwiIHx8IHNhbWVJZChrZXksIFRZUF9QUk9QRVJUWSkgfHwgc2FtZUlkKGtleSwgU1VCVFlQX1BST1BFUlRZKTtcbn1cblxuLy8gQSBibG9jaydzIHByb3BlcnRpZXMgaW4gc3RvcmVkIG9yZGVyLCB2aWEgY29sbGVjdEJsb2NrcygpIChtYWluLmpzKSwgc28gdGhlXG4vLyBzYW1lIHJ1bGVzIGFwcGx5OiB0aGUgU3VidHlwIGJsb2NrIGZvbGxvd3MgdGhlIFRZUC1Gcm9udG1hdHRlciwgYSBrZXkgaW4gYm90aFxuLy8ga2VlcHMgdGhlIFRZUC1Gcm9udG1hdHRlciBwb3NpdGlvbiwgYW5kIHRoZSBTdWJ0eXAncyBmbG9hdGluZyBmbGFnIHdpbnMgLSBhXG4vLyBTdWJ0eXAgY2FuIGtlZXAgYSBzdGFuZGFyZCBwcm9wZXJ0eSBvdXQgb2YgaXRzIHZpZXcgdGhhdCB3YXkuXG5mdW5jdGlvbiBibG9ja0tleXMocGx1Z2luLCB0eXAsIHN1YnR5cCwgaW5jbHVkZUZsb2F0aW5nKSB7XG4gIGNvbnN0IHsgZGVmYXVsdHMgfSA9IHBsdWdpbi5jb2xsZWN0QmxvY2tzKHR5cCwgc3VidHlwLCBpbmNsdWRlRmxvYXRpbmcpO1xuICByZXR1cm4gT2JqZWN0LmtleXMoZGVmYXVsdHMpLmZpbHRlcigoa2V5KSA9PiAhaXNTeXN0ZW1LZXkoa2V5KSk7XG59XG5cbi8vIEV2ZXJ5IFRZUCB0aGF0IGhhcyBhIFN1YnR5cCBvZiB0aGlzIG5hbWUsIGluIFRZUC1MaXN0IG9yZGVyLiBUaGUgc2FtZVxuLy8gU3VidHlwIG5hbWUgbWF5IGV4aXN0IHVuZGVyIHNldmVyYWwgVFlQIGVudHJpZXM7IGEgc3RhbmRhbG9uZSBTdWJ0eXAgQmFzZVxuLy8gZmlsdGVycyBieSBTVUJUWVAgb25seSBhbmQgc28gc2hvd3MgYWxsIG9mIHRoZW0uXG5mdW5jdGlvbiB0eXBzRm9yU3VidHlwKHBsdWdpbiwgc3VidHlwKSB7XG4gIHJldHVybiBwbHVnaW4uc2V0dGluZ3MudHlwcy5maWx0ZXIoKHR5cCkgPT4gZ2V0U3VidHlwTmFtZXMocGx1Z2luLnNldHRpbmdzLCB0eXApLmluY2x1ZGVzKHN1YnR5cCkpO1xufVxuXG4vLyBBIHRhcmdldCBpcyB7IHR5cCwgc3VidHlwIH06XG4vLyAgIHsgdHlwLCBzdWJ0eXA6IG51bGwgfSAgLSB0aGUgVFlQIGl0c2VsZlxuLy8gICB7IHR5cCwgc3VidHlwIH0gICAgICAgIC0gYSBTdWJ0eXAgd2l0aGluIGl0cyBUWVBcbi8vICAgeyB0eXA6IG51bGwsIHN1YnR5cCB9ICAtIGEgU3VidHlwIG5hbWUgbm90IGJvdW5kIHRvIGEgVFlQIChzdGFuZGFsb25lXG4vLyAgICAgICAgICAgICAgICAgICAgICAgICAgICBTdWJ0eXAgQmFzZSwgY29sdW1ucyBtZXJnZWQgYWNyb3NzIFRZUCBlbnRyaWVzKVxuZnVuY3Rpb24gdGFyZ2V0S2V5cyhwbHVnaW4sIHRhcmdldCwgb3B0aW9ucykge1xuICBjb25zdCBzZWVuID0gbmV3IFNldCgpO1xuICBjb25zdCBtYWluID0gW107XG4gIGNvbnN0IG90aGVycyA9IFtdO1xuICBjb25zdCBhZGQgPSAobGlzdCwga2V5cykgPT4ge1xuICAgIGZvciAoY29uc3Qga2V5IG9mIGtleXMpIHtcbiAgICAgIGNvbnN0IGxvd2VyID0ga2V5LnRvTG93ZXJDYXNlKCk7XG4gICAgICBpZiAoc2Vlbi5oYXMobG93ZXIpKSBjb250aW51ZTtcbiAgICAgIHNlZW4uYWRkKGxvd2VyKTtcbiAgICAgIGxpc3QucHVzaChrZXkpO1xuICAgIH1cbiAgfTtcblxuICBpZiAoIXRhcmdldC50eXApIHtcbiAgICBmb3IgKGNvbnN0IHR5cCBvZiB0eXBzRm9yU3VidHlwKHBsdWdpbiwgdGFyZ2V0LnN1YnR5cCkpIHtcbiAgICAgIGFkZChtYWluLCBibG9ja0tleXMocGx1Z2luLCB0eXAsIHRhcmdldC5zdWJ0eXAsIG9wdGlvbnMuZmxvYXRpbmcpKTtcbiAgICB9XG4gICAgcmV0dXJuIHsgbWFpbiwgb3RoZXJzIH07XG4gIH1cblxuICBhZGQobWFpbiwgYmxvY2tLZXlzKHBsdWdpbiwgdGFyZ2V0LnR5cCwgdGFyZ2V0LnN1YnR5cCwgb3B0aW9ucy5mbG9hdGluZykpO1xuICAvLyBPbmx5IGZvciB0aGUgVFlQIHZpZXc6IGluIGEgU3VidHlwIHZpZXcgdGhlIG90aGVyIGJsb2NrcyB3b3VsZCBzdGF5IGVtcHR5LFxuICAvLyBzaW5jZSBhIG5vdGUgaGFzIGF0IG1vc3Qgb25lIFNVQlRZUC4gS2V5cyBhbHJlYWR5IGluIG1haW4gZHJvcCBvdXQgdmlhXG4gIC8vIFwic2VlblwiLlxuICBpZiAob3B0aW9ucy5hbGxTdWJ0eXBzICYmICF0YXJnZXQuc3VidHlwKSB7XG4gICAgZm9yIChjb25zdCBzdWJ0eXAgb2YgZ2V0U3VidHlwTmFtZXMocGx1Z2luLnNldHRpbmdzLCB0YXJnZXQudHlwKSkge1xuICAgICAgYWRkKG90aGVycywgYmxvY2tLZXlzKHBsdWdpbiwgdGFyZ2V0LnR5cCwgc3VidHlwLCBvcHRpb25zLmZsb2F0aW5nKSk7XG4gICAgfVxuICB9XG4gIHJldHVybiB7IG1haW4sIG90aGVycyB9O1xufVxuXG4vLyBUaGUgZmluYWwgY29sdW1uIGxpc3Q6IGZpbGUubmFtZSBmaXJzdCwgdGhlbiB0aGUgZ2xvYmFsIHByb3BlcnR5IG9yZGVyIGFzXG4vLyB0aGUgZnJhbWUuIEl0cyBwbGFjZWhvbGRlcnMgbWVhbiBoZXJlOlxuLy8gICBcInR5cFwiICAgICAgICAgICAgICAgICAgICAgLSBUWVAtRnJvbnRtYXR0ZXIgcGx1cyB0aGUgdGFyZ2V0J3MgU3VidHlwIGJsb2NrXG4vLyAgIFwib3RoZXJcIiAgICAgICAgICAgICAgICAgICAtIHRoZSBwcm9wZXJ0aWVzIG9mIHRoZSBvdGhlciBTdWJ0eXAgYmxvY2tzXG4vLyAgIFwidHlwVmFsdWVcIi9cInN1YnR5cFZhbHVlXCIgIC0gc2tpcHBlZCwgVFlQL1NVQlRZUCBhcmUgbm8gY29sdW1uc1xuLy8gT2YgdGhlIHBpbm5lZCBwcm9wZXJ0aWVzIG9ubHkgdGFncyBjb3VudHMgKGFuZCBvbmx5IHdoZW4gY2hlY2tlZCk6XG4vLyBjc3NjbGFzc2VzIG9yIGFsaWFzZXMgbWFrZSBubyBzZW5zZSBhcyBjb2x1bW5zIG9mIGFuIG92ZXJ2aWV3IHRhYmxlLlxuZnVuY3Rpb24gY29sdW1uSWRzKHBsdWdpbiwgdGFyZ2V0LCBvcHRpb25zKSB7XG4gIGNvbnN0IHsgbWFpbiwgb3RoZXJzIH0gPSB0YXJnZXRLZXlzKHBsdWdpbiwgdGFyZ2V0LCBvcHRpb25zKTtcbiAgY29uc3QgaWRzID0gW107XG4gIGNvbnN0IHNlZW4gPSBuZXcgU2V0KCk7XG4gIGNvbnN0IHB1c2ggPSAoaWQpID0+IHtcbiAgICBjb25zdCBsb3dlciA9IGlkLnRvTG93ZXJDYXNlKCk7XG4gICAgaWYgKHNlZW4uaGFzKGxvd2VyKSkgcmV0dXJuO1xuICAgIHNlZW4uYWRkKGxvd2VyKTtcbiAgICBpZHMucHVzaChpZCk7XG4gIH07XG5cbiAgcHVzaChGSUxFX05BTUVfSUQpO1xuICBsZXQgdGFnc1BsYWNlZCA9IGZhbHNlO1xuICBmb3IgKGNvbnN0IGVudHJ5IG9mIG5vcm1hbGl6ZUdsb2JhbE9yZGVyKHBsdWdpbi5zZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyKSkge1xuICAgIGlmIChlbnRyeS5raW5kID09PSBcInByb3BlcnR5XCIpIHtcbiAgICAgIGlmIChvcHRpb25zLnRhZ3MgJiYgZW50cnkubmFtZSAmJiBzYW1lSWQoZW50cnkubmFtZSwgVEFHU19QUk9QRVJUWSkpIHtcbiAgICAgICAgcHVzaChub3RlSWQoZW50cnkubmFtZSkpO1xuICAgICAgICB0YWdzUGxhY2VkID0gdHJ1ZTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGVudHJ5LmtpbmQgPT09IFwidHlwXCIpIHtcbiAgICAgIGZvciAoY29uc3Qga2V5IG9mIG1haW4pIHB1c2gobm90ZUlkKGtleSkpO1xuICAgIH0gZWxzZSBpZiAoZW50cnkua2luZCA9PT0gXCJvdGhlclwiKSB7XG4gICAgICBmb3IgKGNvbnN0IGtleSBvZiBvdGhlcnMpIHB1c2gobm90ZUlkKGtleSkpO1xuICAgIH1cbiAgfVxuICAvLyBTYWZldHkgbmV0OiBpZiB0YWdzIGlzbid0IGluIHRoZSBnbG9iYWwgb3JkZXIsIGl0IHN0aWxsIGdvZXMgbGFzdC5cbiAgaWYgKG9wdGlvbnMudGFncyAmJiAhdGFnc1BsYWNlZCkgcHVzaChub3RlSWQoVEFHU19QUk9QRVJUWSkpO1xuICByZXR1cm4gaWRzO1xufVxuXG4vKiAtLS0gVmlld3Mgb2YgYSB0YXJnZXQgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tICovXG5cbi8vIHNjb3BlZDogd2hldGhlciBlYWNoIHZpZXcgbXVzdCBjYXJyeSBpdHMgZnVsbCBmaWx0ZXIuIEluIGEgbmV3IEJhc2UgdGhlIFRZUFxuLy8gc2l0cyBpbiB0aGUgcm9vdCBmaWx0ZXIgYW5kIFN1YnR5cCB2aWV3cyBvbmx5IGFkZCBTVUJUWVAuIFZpZXdzIGFwcGVuZGVkIHRvXG4vLyBhbiBleGlzdGluZyBCYXNlIGxlYXZlIGl0cyByb290IGZpbHRlciBhbG9uZSBhbmQgZmlsdGVyIHRoZW1zZWx2ZXMuXG5mdW5jdGlvbiB0YXJnZXRWaWV3cyhwbHVnaW4sIHRhcmdldCwgb3B0aW9ucywgeyBzY29wZWQgfSkge1xuICBpZiAoIXRhcmdldC50eXApIHtcbiAgICBjb25zdCB2aWV3ID0ge1xuICAgICAgdHlwZTogXCJ0YWJsZVwiLFxuICAgICAgbmFtZTogdGFyZ2V0LnN1YnR5cCxcbiAgICAgIG9yZGVyOiBjb2x1bW5JZHMocGx1Z2luLCB0YXJnZXQsIG9wdGlvbnMpLFxuICAgIH07XG4gICAgaWYgKHNjb3BlZCkgdmlldy5maWx0ZXJzID0geyBhbmQ6IFtlcXVhbHNGaWx0ZXIoU1VCVFlQX1BST1BFUlRZLCB0YXJnZXQuc3VidHlwKV0gfTtcbiAgICAvLyBTZXZlcmFsIFRZUCBlbnRyaWVzIHdpdGggdGhpcyBTdWJ0eXAgbmFtZTogZ3JvdXBpbmcgc2VwYXJhdGVzIHRoZW1cbiAgICAvLyB3aXRob3V0IGEgdmlldyBwZXIgVFlQLlxuICAgIGlmICh0eXBzRm9yU3VidHlwKHBsdWdpbiwgdGFyZ2V0LnN1YnR5cCkubGVuZ3RoID4gMSkge1xuICAgICAgdmlldy5ncm91cEJ5ID0geyBwcm9wZXJ0eTogbm90ZUlkKFRZUF9QUk9QRVJUWSksIGRpcmVjdGlvbjogXCJBU0NcIiB9O1xuICAgIH1cbiAgICByZXR1cm4gW3ZpZXddO1xuICB9XG5cbiAgY29uc3QgdHlwID0gdGFyZ2V0LnR5cDtcbiAgY29uc3Qgc3VidHlwcyA9IGdldFN1YnR5cE5hbWVzKHBsdWdpbi5zZXR0aW5ncywgdHlwKTtcbiAgY29uc3QgbWFpbiA9IHtcbiAgICB0eXBlOiBcInRhYmxlXCIsXG4gICAgbmFtZTogdHlwLFxuICAgIG9yZGVyOiBjb2x1bW5JZHMocGx1Z2luLCB7IHR5cCwgc3VidHlwOiBudWxsIH0sIG9wdGlvbnMpLFxuICB9O1xuICBpZiAoc2NvcGVkKSBtYWluLmZpbHRlcnMgPSB7IGFuZDogW2VxdWFsc0ZpbHRlcihUWVBfUFJPUEVSVFksIHR5cCldIH07XG4gIC8vIFdpdGhvdXQgYW55IFN1YnR5cCwgZ3JvdXBpbmcgYnkgYW4gYWx3YXlzLWVtcHR5IHByb3BlcnR5IHdvdWxkIG9ubHkgZ2l2ZVxuICAvLyBvbmUgXCJubyB2YWx1ZVwiIGdyb3VwLlxuICBpZiAoc3VidHlwcy5sZW5ndGggPiAwKSBtYWluLmdyb3VwQnkgPSB7IHByb3BlcnR5OiBub3RlSWQoU1VCVFlQX1BST1BFUlRZKSwgZGlyZWN0aW9uOiBcIkFTQ1wiIH07XG5cbiAgY29uc3Qgdmlld3MgPSBbbWFpbl07XG4gIGZvciAoY29uc3Qgc3VidHlwIG9mIHN1YnR5cHMpIHtcbiAgICB2aWV3cy5wdXNoKHtcbiAgICAgIHR5cGU6IFwidGFibGVcIixcbiAgICAgIG5hbWU6IHN1YnR5cCxcbiAgICAgIC8vIGFsbFN1YnR5cHMgaXMgYWx3YXlzIG9mZiBpbiBhIFN1YnR5cCB2aWV3IChzZWUgdGFyZ2V0S2V5cykuXG4gICAgICBvcmRlcjogY29sdW1uSWRzKHBsdWdpbiwgeyB0eXAsIHN1YnR5cCB9LCB7IC4uLm9wdGlvbnMsIGFsbFN1YnR5cHM6IGZhbHNlIH0pLFxuICAgICAgZmlsdGVyczoge1xuICAgICAgICBhbmQ6IHNjb3BlZFxuICAgICAgICAgID8gW2VxdWFsc0ZpbHRlcihUWVBfUFJPUEVSVFksIHR5cCksIGVxdWFsc0ZpbHRlcihTVUJUWVBfUFJPUEVSVFksIHN1YnR5cCldXG4gICAgICAgICAgOiBbZXF1YWxzRmlsdGVyKFNVQlRZUF9QUk9QRVJUWSwgc3VidHlwKV0sXG4gICAgICB9LFxuICAgIH0pO1xuICB9XG4gIHJldHVybiB2aWV3cztcbn1cblxuLy8gQSB2aWV3IG9iamVjdCBhcyBpdCBhcHBlYXJzIGluIHRoZSBmaWxlOiB3aXRob3V0IFwibm90ZS5cIiBhbmQgd2l0aCB0aGUga2V5XG4vLyBvcmRlciBCYXNlcyBpdHNlbGYgd3JpdGVzLlxuZnVuY3Rpb24gc2VyaWFsaXplVmlldyh2aWV3KSB7XG4gIGNvbnN0IG91dCA9IHsgdHlwZTogdmlldy50eXBlLCBuYW1lOiB2aWV3Lm5hbWUgfTtcbiAgaWYgKHZpZXcuZmlsdGVycykgb3V0LmZpbHRlcnMgPSB2aWV3LmZpbHRlcnM7XG4gIGlmICh2aWV3Lm9yZGVyKSBvdXQub3JkZXIgPSB2aWV3Lm9yZGVyLm1hcChzZXJpYWxpemVJZCk7XG4gIGlmICh2aWV3Lmdyb3VwQnkpIHtcbiAgICBvdXQuZ3JvdXBCeSA9IHsgcHJvcGVydHk6IHNlcmlhbGl6ZUlkKHZpZXcuZ3JvdXBCeS5wcm9wZXJ0eSksIGRpcmVjdGlvbjogdmlldy5ncm91cEJ5LmRpcmVjdGlvbiB9O1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbi8qIC0tLSBPcGVuaW5nIGFuZCB3cml0aW5nIHRoZSBmaWxlIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gKi9cblxuZnVuY3Rpb24gd2FpdEZvcihtcykge1xuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHdpbmRvdy5zZXRUaW1lb3V0KHJlc29sdmUsIG1zKSk7XG59XG5cbi8vIE9wZW5zIHRoZSBCYXNlIGFuZCB3YWl0cyB1bnRpbCBpdHMgcXVlcnkgaXMgcGFyc2VkOyBvbmx5IHRoZW4gY2FuIGl0IGJlXG4vLyByZWFkIGFuZCB3cml0dGVuLiBSZXVzZXMgYSB0YWIgdGhhdCBhbHJlYWR5IHNob3dzIHRoZSBmaWxlLlxuYXN5bmMgZnVuY3Rpb24gb3BlbkJhc2UoYXBwLCBmaWxlKSB7XG4gIGNvbnN0IG9wZW4gPSBhcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcImJhc2VzXCIpLmZpbmQoKGxlYWYpID0+IGxlYWYudmlldz8uZmlsZT8ucGF0aCA9PT0gZmlsZS5wYXRoKTtcbiAgY29uc3QgbGVhZiA9IG9wZW4gPz8gYXBwLndvcmtzcGFjZS5nZXRMZWFmKFwidGFiXCIpO1xuICBpZiAob3BlbikgYXBwLndvcmtzcGFjZS5yZXZlYWxMZWFmKGxlYWYpO1xuICBlbHNlIGF3YWl0IGxlYWYub3BlbkZpbGUoZmlsZSwgeyBhY3RpdmU6IHRydWUgfSk7XG4gIGZvciAobGV0IGF0dGVtcHQgPSAwOyBhdHRlbXB0IDwgNDAgJiYgIWxlYWYudmlldz8ucXVlcnk7IGF0dGVtcHQrKykgYXdhaXQgd2FpdEZvcigyNSk7XG4gIHJldHVybiBsZWFmLnZpZXc/LnF1ZXJ5ID8gbGVhZi52aWV3IDogbnVsbDtcbn1cblxuLy8gQXBwZW5kcyB2aWV3cyB0byBhbiBleGlzdGluZyBCYXNlLiBnZXRTZXJpYWxpemFibGUoKSByZXR1cm5zIGV4YWN0bHkgd2hhdFxuLy8gQmFzZXMgd3JpdGVzIHdoZW4gaXQgc2F2ZXMgKHZlcmlmaWVkOiB0aGUgcm91bmQgdHJpcCByZXByb2R1Y2VzIGV4aXN0aW5nXG4vLyBmaWxlcyBieXRlIGZvciBieXRlLCBmb3JtdWxhIGJsb2NrcyBhbmQgc3BlY2lhbCBrZXlzIGluY2x1ZGVkKTsgb25seSB0aGVcbi8vIHZpZXdzIGxpc3QgaXMgdG91Y2hlZC5cbi8vXG4vLyB2YXVsdC5wcm9jZXNzIHJhdGhlciB0aGFuIHZhdWx0Lm1vZGlmeSwgYXMgT2JzaWRpYW4gcmVjb21tZW5kcyBmb3IgY2hhbmdlc1xuLy8gdG8gYSBmaWxlIHRoYXQgbWF5IGJlIG9wZW46IGl0IHdyaXRlcyBhdG9taWNhbGx5LiBUaGUgY2FsbGJhY2sgaWdub3JlcyB0aGVcbi8vIGZpbGUgdGV4dCBvbiBwdXJwb3NlIC0gZGF0YSBjb21lcyBmcm9tIHRoZSBwYXJzZWQgcXVlcnksIHdoaWNoIHRoZSBvcGVuXG4vLyBCYXNlIGtlZXBzIGluIHN0ZXAgd2l0aCB0aGUgZmlsZS5cbmFzeW5jIGZ1bmN0aW9uIGFwcGVuZFZpZXdzKGFwcCwgdmlldywgdmlld3MpIHtcbiAgY29uc3QgZGF0YSA9IHZpZXcucXVlcnkuZ2V0U2VyaWFsaXphYmxlKCk7XG4gIGRhdGEudmlld3MgPSBbLi4uKGRhdGEudmlld3MgPz8gW10pLCAuLi52aWV3cy5tYXAoc2VyaWFsaXplVmlldyldO1xuICBhd2FpdCBhcHAudmF1bHQucHJvY2Vzcyh2aWV3LmZpbGUsICgpID0+IHN0cmluZ2lmeVlhbWwoZGF0YSkpO1xufVxuXG4vKiAtLS0gQ29tbWFuZDogQ3JlYXRlIEJhc2UgZm9yIFRZUCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tICovXG5cbmFzeW5jIGZ1bmN0aW9uIGNyZWF0ZUJhc2UocGx1Z2luLCB0YXJnZXQsIG9wdGlvbnMpIHtcbiAgY29uc3QgYXBwID0gcGx1Z2luLmFwcDtcbiAgY29uc3QgbmFtZSA9IHRhcmdldC5zdWJ0eXAgPz8gdGFyZ2V0LnR5cDtcbiAgY29uc3QgcGF0aCA9IGAke25hbWV9LiR7QkFTRV9FWFRFTlNJT059YDtcbiAgY29uc3QgZXhpc3RpbmcgPSBhcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKHBhdGgpO1xuXG4gIGlmIChleGlzdGluZyAmJiAhKGV4aXN0aW5nIGluc3RhbmNlb2YgVEZpbGUpKSB7XG4gICAgbmV3IE5vdGljZShgXCIke3BhdGh9XCIgaXMgbm90IGEgZmlsZSBcdTIwMTMgQmFzZSBub3QgY3JlYXRlZC5gKTtcbiAgICByZXR1cm47XG4gIH1cblxuICBpZiAoIWV4aXN0aW5nKSB7XG4gICAgY29uc3Qgdmlld3MgPSB0YXJnZXRWaWV3cyhwbHVnaW4sIHRhcmdldCwgb3B0aW9ucywgeyBzY29wZWQ6IGZhbHNlIH0pO1xuICAgIGNvbnN0IHJvb3QgPSB0YXJnZXQudHlwXG4gICAgICA/IHsgYW5kOiBbZXF1YWxzRmlsdGVyKFRZUF9QUk9QRVJUWSwgdGFyZ2V0LnR5cCldIH1cbiAgICAgIDogeyBhbmQ6IFtlcXVhbHNGaWx0ZXIoU1VCVFlQX1BST1BFUlRZLCB0YXJnZXQuc3VidHlwKV0gfTtcbiAgICBjb25zdCBmaWxlID0gYXdhaXQgYXBwLnZhdWx0LmNyZWF0ZShwYXRoLCBzdHJpbmdpZnlZYW1sKHsgZmlsdGVyczogcm9vdCwgdmlld3M6IHZpZXdzLm1hcChzZXJpYWxpemVWaWV3KSB9KSk7XG4gICAgYXdhaXQgb3BlbkJhc2UoYXBwLCBmaWxlKTtcbiAgICBuZXcgTm90aWNlKGBDcmVhdGVkICR7cGF0aH0gd2l0aCAke3BsdXJhbCh2aWV3cy5sZW5ndGgsIFwidmlld1wiKX0uYCk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gVGhlIGZpbGUgZXhpc3RzOiBhZGQgd2hhdCBpcyBtaXNzaW5nLiBBIHZpZXcgd2l0aCB0aGUgc2FtZSBuYW1lIHN0YXlzXG4gIC8vIHVudG91Y2hlZCAtIGl0IG1heSBiZSBoYW5kLW1hZGUsIGFuZCBvdmVyd3JpdGluZyBpdCB3b3VsZCBiZSBhIHNpbGVudCBsb3NzLlxuICBjb25zdCB2aWV3ID0gYXdhaXQgb3BlbkJhc2UoYXBwLCBleGlzdGluZyk7XG4gIGlmICghdmlldykge1xuICAgIG5ldyBOb3RpY2UoYENvdWxkbid0IHJlYWQgJHtwYXRofSBcdTIwMTMgQmFzZSBub3QgdXBkYXRlZC5gKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgcHJlc2VudCA9IG5ldyBTZXQodmlldy5xdWVyeS52aWV3cy5tYXAoKGNmZykgPT4gY2ZnLm5hbWUpKTtcbiAgY29uc3Qgd2FudGVkID0gdGFyZ2V0Vmlld3MocGx1Z2luLCB0YXJnZXQsIG9wdGlvbnMsIHsgc2NvcGVkOiB0cnVlIH0pO1xuICBjb25zdCB0b0FkZCA9IHdhbnRlZC5maWx0ZXIoKGVudHJ5KSA9PiAhcHJlc2VudC5oYXMoZW50cnkubmFtZSkpO1xuICBjb25zdCBza2lwcGVkID0gd2FudGVkLmZpbHRlcigoZW50cnkpID0+IHByZXNlbnQuaGFzKGVudHJ5Lm5hbWUpKS5tYXAoKGVudHJ5KSA9PiBlbnRyeS5uYW1lKTtcblxuICBpZiAodG9BZGQubGVuZ3RoID4gMCkgYXdhaXQgYXBwZW5kVmlld3MoYXBwLCB2aWV3LCB0b0FkZCk7XG5cbiAgY29uc3QgcGFydHMgPSBbXTtcbiAgcGFydHMucHVzaCh0b0FkZC5sZW5ndGggPiAwID8gYCR7cGF0aH06IGFkZGVkICR7cGx1cmFsKHRvQWRkLmxlbmd0aCwgXCJ2aWV3XCIpfS5gIDogYCR7cGF0aH06IG5vdGhpbmcgdG8gYWRkLmApO1xuICBpZiAoc2tpcHBlZC5sZW5ndGggPiAwKSBwYXJ0cy5wdXNoKGBBbHJlYWR5IHByZXNlbnQsIGxlZnQgdW5jaGFuZ2VkOiAke3NraXBwZWQuam9pbihcIiwgXCIpfS5gKTtcbiAgbmV3IE5vdGljZShwYXJ0cy5qb2luKFwiIFwiKSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGNyZWF0ZUJhc2VDb21tYW5kKHBsdWdpbikge1xuICAvLyBpbmNsdWRlTWFudWFsT2ZmOiBhIEJhc2UgaXMgZXNwZWNpYWxseSB1c2VmdWwgZm9yIFRZUCBlbnRyaWVzIHRoYXQgYXJlbid0XG4gIC8vIHNldCBieSBoYW5kIChLT05UQUtULCBNRURJQSwgRVhURVJOKS4gVW5yZWdpc3RlcmVkIHZhbHVlcyBhcmUgbGVmdCBvdXQgLVxuICAvLyB0aGV5IGhhdmUgbm8gVFlQLUZyb250bWF0dGVyIGFuZCBzbyBubyBjb2x1bW5zLlxuICBjb25zdCBjaG9pY2UgPSBhd2FpdCBwbHVnaW4ucGlja1R5cEFuZFN1YnR5cCh7IGluY2x1ZGVNYW51YWxPZmY6IHRydWUgfSk7XG4gIGlmICghY2hvaWNlKSByZXR1cm47XG5cbiAgLy8gQSBTdWJ0eXAgcGlja2VkIGhlcmUgbWVhbnMgdGhlIHN0YW5kYWxvbmUgU3VidHlwIEJhc2U6IGl0IGZpbHRlcnMgYnlcbiAgLy8gU1VCVFlQIG9ubHkgYW5kIG1lcmdlcyB0aGUgY29sdW1ucyBvZiBldmVyeSBUWVAgd2l0aCB0aGF0IFN1YnR5cCBuYW1lLlxuICBjb25zdCB0YXJnZXQgPSBjaG9pY2Uuc3VidHlwID8geyB0eXA6IG51bGwsIHN1YnR5cDogY2hvaWNlLnN1YnR5cCB9IDogeyB0eXA6IGNob2ljZS50eXAsIHN1YnR5cDogbnVsbCB9O1xuICBhd2FpdCBjcmVhdGVCYXNlRm9yKHBsdWdpbiwgdGFyZ2V0KTtcbn1cblxuLy8gVGhlIGNvbW1hbmQgYWZ0ZXIgaXRzIHBpY2tlciwgYWxzbyB0aGUgZW50cnkgd2l0aCBhIGZpeGVkIHRhcmdldCAoY29udGV4dFxuLy8gbWVudSBvZiB0aGUgVFlQLUxpc3QpOiBjb2x1bW4gb3B0aW9ucywgdGhlbiBjcmVhdGUgb3IgY29tcGxldGUgdGhlIGZpbGUuXG5hc3luYyBmdW5jdGlvbiBjcmVhdGVCYXNlRm9yKHBsdWdpbiwgdGFyZ2V0KSB7XG4gIGNvbnN0IG9wdGlvbnMgPSBhd2FpdCBhc2tDb2x1bW5PcHRpb25zKHBsdWdpbiwgdGFyZ2V0LCAoY3VycmVudCkgPT4gY29sdW1uSWRzKHBsdWdpbiwgdGFyZ2V0LCBjdXJyZW50KSk7XG4gIGlmICghb3B0aW9ucykgcmV0dXJuO1xuICBhd2FpdCBjcmVhdGVCYXNlKHBsdWdpbiwgdGFyZ2V0LCBvcHRpb25zKTtcbn1cblxuLyogLS0tIENvbW1hbmQ6IFVwZGF0ZSBjb2x1bW5zIG9mIEJhc2UgdmlldyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSAqL1xuXG4vLyBUaGUgbW9zdCByZWNlbnQgbGVhZiBvZiB0aGUgbWFpbiBhcmVhLCBub3Qgd29ya3NwYWNlLmFjdGl2ZUxlYWYgKGRlcHJlY2F0ZWQpOlxuLy8gdGhhdCBpcyBhbHNvIGEgc2lkZWJhciBsZWFmLCBlLmcuIHRoZSBUWVAtUGFuZSB3aGVuIGl0IHdhcyBjbGlja2VkIGxhc3QuXG5mdW5jdGlvbiBhY3RpdmVCYXNlVmlldyhwbHVnaW4pIHtcbiAgY29uc3QgbGVhZiA9IHBsdWdpbi5hcHAud29ya3NwYWNlLmdldE1vc3RSZWNlbnRMZWFmKCk7XG4gIGNvbnN0IHZpZXcgPSBsZWFmPy52aWV3O1xuICBpZiAoIXZpZXcgfHwgdHlwZW9mIHZpZXcuZ2V0Vmlld1R5cGUgIT09IFwiZnVuY3Rpb25cIiB8fCB2aWV3LmdldFZpZXdUeXBlKCkgIT09IFwiYmFzZXNcIikgcmV0dXJuIG51bGw7XG4gIHJldHVybiB2aWV3LnF1ZXJ5ID8gdmlldyA6IG51bGw7XG59XG5cbmZ1bmN0aW9uIHNlcmlhbGl6ZUZpbHRlcnMoZmlsdGVycykge1xuICByZXR1cm4gdHlwZW9mIGZpbHRlcnM/LnNlcmlhbGl6ZSA9PT0gXCJmdW5jdGlvblwiID8gZmlsdGVycy5zZXJpYWxpemUoKSA6IG51bGw7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHVwZGF0ZUFjdGl2ZVZpZXcocGx1Z2luLCB2aWV3KSB7XG4gIGNvbnN0IHF1ZXJ5ID0gdmlldy5xdWVyeTtcbiAgY29uc3Qgdmlld05hbWUgPSB2aWV3LmNvbnRyb2xsZXI/LnZpZXdOYW1lO1xuICBjb25zdCBjZmcgPSAodmlld05hbWUgPyBxdWVyeS5nZXRWaWV3Q29uZmlnKHZpZXdOYW1lKSA6IG51bGwpID8/IHF1ZXJ5LnZpZXdzWzBdO1xuICBpZiAoIWNmZykge1xuICAgIG5ldyBOb3RpY2UoXCJObyBhY3RpdmUgdmlldy5cIik7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgbGV0IHRhcmdldCA9IHJlYWRUYXJnZXQoc2VyaWFsaXplRmlsdGVycyhxdWVyeS5maWx0ZXJzKSwgc2VyaWFsaXplRmlsdGVycyhjZmcuZmlsdGVycykpO1xuICBpZiAoIXRhcmdldCkge1xuICAgIC8vIE5vIHVuYW1iaWd1b3VzIFRZUCBpbiB0aGUgZmlsdGVyIChoYW5kLXdyaXR0ZW4gT1IgZ3JvdXAsIG5vIGZpbHRlciBhdFxuICAgIC8vIGFsbCk6IGFzaywgYW5kIHN0b3JlIHRoZSBhbnN3ZXIgYXMgYSBmaWx0ZXIgc28gdGhlIG5leHQgcnVuIHJlYWRzIGl0LlxuICAgIGNvbnN0IGNob2ljZSA9IGF3YWl0IHBsdWdpbi5waWNrVHlwQW5kU3VidHlwKHsgaW5jbHVkZU1hbnVhbE9mZjogdHJ1ZSB9KTtcbiAgICBpZiAoIWNob2ljZSkgcmV0dXJuO1xuICAgIHRhcmdldCA9IHsgdHlwOiBjaG9pY2UudHlwLCBzdWJ0eXA6IGNob2ljZS5zdWJ0eXAgfTtcbiAgICBjb25zdCBhbmQgPSBbZXF1YWxzRmlsdGVyKFRZUF9QUk9QRVJUWSwgY2hvaWNlLnR5cCldO1xuICAgIGlmIChjaG9pY2Uuc3VidHlwKSBhbmQucHVzaChlcXVhbHNGaWx0ZXIoU1VCVFlQX1BST1BFUlRZLCBjaG9pY2Uuc3VidHlwKSk7XG4gICAgcXVlcnkuc2V0Vmlld0ZpbHRlcnMoY2ZnLm5hbWUsIHsgYW5kIH0pO1xuICB9XG5cbiAgY29uc3Qgb3B0aW9ucyA9IGF3YWl0IGFza0NvbHVtbk9wdGlvbnMocGx1Z2luLCB0YXJnZXQsIChjdXJyZW50KSA9PiBjb2x1bW5JZHMocGx1Z2luLCB0YXJnZXQsIGN1cnJlbnQpKTtcbiAgaWYgKCFvcHRpb25zKSByZXR1cm47XG5cbiAgY29uc3QgZGVzaXJlZCA9IGNvbHVtbklkcyhwbHVnaW4sIHRhcmdldCwgb3B0aW9ucyk7XG4gIGNvbnN0IGRlc2lyZWRMb3dlciA9IG5ldyBTZXQoZGVzaXJlZC5tYXAoKGlkKSA9PiBpZC50b0xvd2VyQ2FzZSgpKSk7XG4gIC8vIEEgdmlldyB3aXRob3V0IGl0cyBvd24gb3JkZXIgc2hvd3MgZXZlcnkgcHJvcGVydHkgLSBub3RoaW5nIHRvIHJlbW92ZSxcbiAgLy8gdGhlIGdlbmVyYXRlZCBsaXN0IHNpbXBseSB0YWtlcyBpdHMgcGxhY2UuXG4gIGNvbnN0IGN1cnJlbnQgPSBBcnJheS5pc0FycmF5KGNmZy5vcmRlcikgPyBbLi4uY2ZnLm9yZGVyXSA6IFtdO1xuICBjb25zdCBleHRyYXMgPSBjdXJyZW50LmZpbHRlcigoaWQpID0+ICFkZXNpcmVkTG93ZXIuaGFzKGlkLnRvTG93ZXJDYXNlKCkpKTtcblxuICBsZXQga2VwdCA9IFtdO1xuICBpZiAoZXh0cmFzLmxlbmd0aCA+IDApIHtcbiAgICBjb25zdCByZW1vdmFscyA9IGF3YWl0IGFza1JlbW92YWxzKHBsdWdpbiwgZXh0cmFzLCBjZmcubmFtZSk7XG4gICAgaWYgKCFyZW1vdmFscykgcmV0dXJuO1xuICAgIGtlcHQgPSBleHRyYXMuZmlsdGVyKChpZCkgPT4gIXJlbW92YWxzLmhhcyhpZCkpO1xuICB9XG5cbiAgLy8gS2VwdCBjb2x1bW5zIHN0YXkgdXAgZnJvbnQsIHJpZ2h0IGFmdGVyIGZpbGUubmFtZTogaGFuZC1hZGRlZCBvbmVzXG4gIC8vIChmb3JtdWxhIGNvbHVtbnMsIHNheSkgc2hvdWxkbid0IHNsaWRlIHRvIHRoZSBlbmQuXG4gIGNvbnN0IG5ld09yZGVyID0gW1xuICAgIEZJTEVfTkFNRV9JRCxcbiAgICAuLi5rZXB0LmZpbHRlcigoaWQpID0+ICFzYW1lSWQoaWQsIEZJTEVfTkFNRV9JRCkpLFxuICAgIC4uLmRlc2lyZWQuZmlsdGVyKChpZCkgPT4gIXNhbWVJZChpZCwgRklMRV9OQU1FX0lEKSksXG4gIF07XG5cbiAgaWYgKG5ld09yZGVyLmxlbmd0aCA9PT0gY3VycmVudC5sZW5ndGggJiYgbmV3T3JkZXIuZXZlcnkoKGlkLCBpbmRleCkgPT4gaWQgPT09IGN1cnJlbnRbaW5kZXhdKSkge1xuICAgIG5ldyBOb3RpY2UoYFZpZXcgXCIke2NmZy5uYW1lfVwiOiBjb2x1bW5zIGFyZSBhbHJlYWR5IHVwIHRvIGRhdGUuYCk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgY29uc3QgYWRkZWQgPSBkZXNpcmVkLmZpbHRlcigoaWQpID0+ICFjdXJyZW50LnNvbWUoKGV4aXN0aW5nKSA9PiBzYW1lSWQoZXhpc3RpbmcsIGlkKSkpLmxlbmd0aDtcbiAgY29uc3QgcmVtb3ZlZCA9IGV4dHJhcy5sZW5ndGggLSBrZXB0Lmxlbmd0aDtcbiAgY2ZnLnNldE9yZGVyKG5ld09yZGVyKTtcbiAgbmV3IE5vdGljZShgVmlldyBcIiR7Y2ZnLm5hbWV9XCI6IGFkZGVkICR7cGx1cmFsKGFkZGVkLCBcImNvbHVtblwiKX0sIHJlbW92ZWQgJHtyZW1vdmVkfS5gKTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIGlzQmFzZXNFbmFibGVkLFxuICBjcmVhdGVCYXNlQ29tbWFuZCxcbiAgY3JlYXRlQmFzZUZvcixcbiAgYWN0aXZlQmFzZVZpZXcsXG4gIHVwZGF0ZUFjdGl2ZVZpZXcsXG4gIC8vIEV4cG9zZWQgZm9yIHRlc3Rpbmcgc2luZ2xlIGJ1aWxkaW5nIGJsb2Nrc1xuICBjb2x1bW5JZHMsXG4gIHJlYWRUYXJnZXQsXG4gIHRhcmdldFZpZXdzLFxufTtcbiIsICJjb25zdCB7IE5vdGljZSB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyBydW5Gcm9udG1hdHRlclNvcnQsIHNvcnRTaW5nbGVGaWxlRnJvbnRtYXR0ZXIgfSA9IHJlcXVpcmUoXCIuL2Zyb250bWF0dGVyLXNvcnRcIik7XG5jb25zdCB7IGlzQmFzZXNFbmFibGVkLCBjcmVhdGVCYXNlQ29tbWFuZCwgYWN0aXZlQmFzZVZpZXcsIHVwZGF0ZUFjdGl2ZVZpZXcgfSA9IHJlcXVpcmUoXCIuL2Jhc2VzXCIpO1xuXG4vLyBPYnNpZGlhbiBuZWl0aGVyIGF3YWl0cyBhIGNvbW1hbmQgY2FsbGJhY2sgKG9yIGEgbWVudSBpdGVtJ3Mgb25DbGljaykgbm9yXG4vLyBjYXRjaGVzIGl0cyBlcnJvcnMsIHNvIGFuIGV4Y2VwdGlvbiB3b3VsZCB2YW5pc2ggaW50byB0aGUgY29uc29sZS4gVGhlc2Vcbi8vIGFjdGlvbnMgYWx3YXlzIGVuZCBpbiBhIG5vdGljZSBpbnN0ZWFkLiBBbHNvIHVzZWQgYnkgdGhlIFRZUC1QYW5lJ3MgY29udGV4dFxuLy8gbWVudS5cbmNvbnN0IHJ1bk9yUmVwb3J0RXJyb3IgPSAobGFiZWwsIGZuKSA9PiBhc3luYyAoKSA9PiB7XG4gIHRyeSB7XG4gICAgYXdhaXQgZm4oKTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBjb25zb2xlLmVycm9yKGBbJHtsYWJlbH1dYCwgZXJyb3IpO1xuICAgIG5ldyBOb3RpY2UoYCR7bGFiZWx9IGZhaWxlZDogJHtlcnJvci5tZXNzYWdlfWApO1xuICB9XG59O1xuXG5mdW5jdGlvbiByZWdpc3RlckNvbW1hbmRzKHBsdWdpbikge1xuXG4gIHBsdWdpbi5hZGRDb21tYW5kKHtcbiAgICBpZDogXCJzb3J0LWZyb250bWF0dGVyLWFsbFwiLFxuICAgIG5hbWU6IFwiU29ydCBmcm9udG1hdHRlciBpbiBhbGwgbm90ZXNcIixcbiAgICAvLyBBc2tzIGZpcnN0IHdoZW4gdGhlIHJ1biBpcyBsYXJnZSwgc2VlIHJ1bkZyb250bWF0dGVyU29ydC5cbiAgICBjYWxsYmFjazogcnVuT3JSZXBvcnRFcnJvcihcIkZyb250bWF0dGVyIHNvcnRpbmdcIiwgKCkgPT4gcnVuRnJvbnRtYXR0ZXJTb3J0KHBsdWdpbiwgbnVsbCkpLFxuICB9KTtcblxuICBwbHVnaW4uYWRkQ29tbWFuZCh7XG4gICAgaWQ6IFwic29ydC1mcm9udG1hdHRlci10eXBcIixcbiAgICBuYW1lOiBcIlNvcnQgZnJvbnRtYXR0ZXIgZm9yIG9uZSBUWVBcIixcbiAgICBjYWxsYmFjazogcnVuT3JSZXBvcnRFcnJvcihcIkZyb250bWF0dGVyIHNvcnRpbmdcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gU29ydGluZyBtYWtlcyBzZW5zZSBmb3IgYW55IFRZUCwgbWFudWFsbHkgY3JlYXRhYmxlIG9yIG5vdCwgcmVnaXN0ZXJlZFxuICAgICAgLy8gb3Igbm90LlxuICAgICAgY29uc3QgdHlwID0gYXdhaXQgcGx1Z2luLnBpY2tUeXAoeyBpbmNsdWRlTWFudWFsT2ZmOiB0cnVlLCBpbmNsdWRlVW5yZWdpc3RlcmVkOiB0cnVlIH0pO1xuICAgICAgaWYgKCF0eXApIHJldHVybjtcbiAgICAgIGF3YWl0IHJ1bkZyb250bWF0dGVyU29ydChwbHVnaW4sIHR5cCk7XG4gICAgfSksXG4gIH0pO1xuXG4gIHBsdWdpbi5hZGRDb21tYW5kKHtcbiAgICBpZDogXCJzb3J0LWZyb250bWF0dGVyLWFjdGl2ZS1ub3RlXCIsXG4gICAgbmFtZTogXCJTb3J0IGZyb250bWF0dGVyIG9mIGFjdGl2ZSBub3RlXCIsXG4gICAgY2hlY2tDYWxsYmFjazogKGNoZWNraW5nKSA9PiB7XG4gICAgICBjb25zdCBmaWxlID0gcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlRmlsZSgpO1xuICAgICAgaWYgKCFmaWxlIHx8IGZpbGUuZXh0ZW5zaW9uICE9PSBcIm1kXCIpIHJldHVybiBmYWxzZTtcbiAgICAgIGlmIChjaGVja2luZykgcmV0dXJuIHRydWU7XG5cbiAgICAgIHJ1bk9yUmVwb3J0RXJyb3IoXCJGcm9udG1hdHRlciBzb3J0aW5nXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgY2hhbmdlZCA9IGF3YWl0IHNvcnRTaW5nbGVGaWxlRnJvbnRtYXR0ZXIocGx1Z2luLmFwcCwgcGx1Z2luLCBmaWxlKTtcbiAgICAgICAgbmV3IE5vdGljZShjaGFuZ2VkID8gYFNvcnRlZCBmcm9udG1hdHRlciBvZiBcIiR7ZmlsZS5iYXNlbmFtZX1cIi5gIDogYEZyb250bWF0dGVyIG9mIFwiJHtmaWxlLmJhc2VuYW1lfVwiIHdhcyBhbHJlYWR5IHNvcnRlZC5gKTtcbiAgICAgIH0pKCk7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9LFxuICB9KTtcblxuICAvLyBDcmVhdGVzIGEgLmJhc2UgZm9yIHRoZSBjaG9zZW4gVFlQIG9yIFN1YnR5cCBpbiB0aGUgdmF1bHQgcm9vdCwgc2VlIGJhc2VzLmpzLlxuICAvLyBIaWRkZW4gd2hpbGUgdGhlIEJhc2VzIGNvcmUgcGx1Z2luIGlzIG9mZjogdGhlIGZpbGUgY291bGRuJ3QgYmUgb3BlbmVkLlxuICBwbHVnaW4uYWRkQ29tbWFuZCh7XG4gICAgaWQ6IFwiY3JlYXRlLWJhc2UtZm9yLXR5cFwiLFxuICAgIG5hbWU6IFwiQ3JlYXRlIEJhc2UgZm9yIFRZUFwiLFxuICAgIGNoZWNrQ2FsbGJhY2s6IChjaGVja2luZykgPT4ge1xuICAgICAgaWYgKCFpc0Jhc2VzRW5hYmxlZChwbHVnaW4uYXBwKSkgcmV0dXJuIGZhbHNlO1xuICAgICAgaWYgKGNoZWNraW5nKSByZXR1cm4gdHJ1ZTtcblxuICAgICAgcnVuT3JSZXBvcnRFcnJvcihcIkNyZWF0ZSBCYXNlXCIsICgpID0+IGNyZWF0ZUJhc2VDb21tYW5kKHBsdWdpbikpKCk7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9LFxuICB9KTtcblxuICAvLyBCcmluZ3MgdGhlIGNvbHVtbnMgb2YgdGhlIHZpc2libGUgQmFzZSB2aWV3IGluIGxpbmUgd2l0aCBpdHMgVFlQLiBXaXRob3V0XG4gIC8vIGFuIG9wZW4gQmFzZSB0aGUgY29tbWFuZCBoYXMgbm8gdGFyZ2V0IGFuZCBpcyBoaWRkZW4uXG4gIHBsdWdpbi5hZGRDb21tYW5kKHtcbiAgICBpZDogXCJ1cGRhdGUtYmFzZS12aWV3LWNvbHVtbnNcIixcbiAgICBuYW1lOiBcIlVwZGF0ZSBjb2x1bW5zIG9mIEJhc2Ugdmlld1wiLFxuICAgIGNoZWNrQ2FsbGJhY2s6IChjaGVja2luZykgPT4ge1xuICAgICAgY29uc3QgdmlldyA9IGFjdGl2ZUJhc2VWaWV3KHBsdWdpbik7XG4gICAgICBpZiAoIXZpZXcpIHJldHVybiBmYWxzZTtcbiAgICAgIGlmIChjaGVja2luZykgcmV0dXJuIHRydWU7XG5cbiAgICAgIHJ1bk9yUmVwb3J0RXJyb3IoXCJVcGRhdGUgQmFzZVwiLCAoKSA9PiB1cGRhdGVBY3RpdmVWaWV3KHBsdWdpbiwgdmlldykpKCk7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9LFxuICB9KTtcblxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJDb21tYW5kcywgcnVuT3JSZXBvcnRFcnJvciB9O1xuIiwgImNvbnN0IHsgTm90aWNlIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5cbi8vIFVuZG8gZm9yIHRoZSBhY3Rpb25zIHRoYXQgcnVuIHdpdGhvdXQgYXNraW5nIChkZWxldGUgYSBTdWJ0eXAsIHJlbW92ZSBhXG4vLyBzaG9ydGN1dCwgdG9nZ2xlIGZsb2F0aW5nLCByZXNldCBhIGNvbG9yKTogYSBub3RpY2Ugd2l0aCBhbiBcIlVuZG9cIiBidXR0b25cbi8vIHJpZ2h0IGFmdGVyIHRoZSBhY3Rpb24uIE9ubHkgcGx1Z2luIHNldHRpbmdzLCBuZXZlciBub3RlcywgYW5kIG9ubHkgdGhlXG4vLyBMQVNUIGFjdGlvbiAtIGEgbmV3IG9mZmVyIHJlcGxhY2VzIHRoZSBwcmV2aW91cyBvbmUsIHNvIHRoZXJlIGlzIG5vIGhpc3Rvcnlcbi8vIGFuZCBubyBjb21tYW5kLlxuLy9cbi8vIFBhdHRlcm4gYXQgdGhlIGNhbGwgc2l0ZTogc25hcHNob3QgPSBzbmFwc2hvdFNldHRpbmdzKHBsdWdpbikgYmVmb3JlIHRoZVxuLy8gY2hhbmdlLCB0aGVuIHRoZSBhY3Rpb24gYXMgdXN1YWwgKGluY2x1ZGluZyBzYXZlU2V0dGluZ3MoKSksIHRoZW5cbi8vIG9mZmVyVW5kbygpLiBvZmZlclVuZG8oKSBtdXN0IGNvbWUgYWZ0ZXIgc2F2ZVNldHRpbmdzKCkgaGFzIGJlZW4gQ0FMTEVEIChub3Rcbi8vIG5lY2Vzc2FyaWx5IGF3YWl0ZWQpLCBzaW5jZSB0aGF0IGlzIHdoYXQgYnVtcHMgc2V0dGluZ3NSZXZpc2lvbi5cblxuY29uc3QgVU5ET19OT1RJQ0VfRFVSQVRJT04gPSA4MDAwO1xuXG4vLyB7IHRva2VuLCByZXZpc2lvbiwgc25hcHNob3QgfSBvZiB0aGUgbGFzdCBhY3Rpb24sIG9yIG51bGwuXG5sZXQgY3VycmVudCA9IG51bGw7XG5cbi8vIFRoZSBzZXR0aW5ncyBhcmUgcGxhaW4gSlNPTiwgc28gc3RydWN0dXJlZENsb25lIGlzIGEgY29tcGxldGUgY29weS5cbmZ1bmN0aW9uIHNuYXBzaG90U2V0dGluZ3MocGx1Z2luKSB7XG4gIHJldHVybiBzdHJ1Y3R1cmVkQ2xvbmUocGx1Z2luLnNldHRpbmdzKTtcbn1cblxuZnVuY3Rpb24gb2ZmZXJVbmRvKHBsdWdpbiwgbWVzc2FnZSwgc25hcHNob3QpIHtcbiAgY29uc3QgdG9rZW4gPSB7fTtcbiAgLy8gc2V0dGluZ3NSZXZpc2lvbiBjb3VudHMgZXZlcnkgc2F2ZSBhbmQgZXZlcnkgZXh0ZXJuYWwgcmVsb2FkIChzZWVcbiAgLy8gc2F2ZVNldHRpbmdzIGluIG1haW4uanMpLiBJZiBpdCBtb3ZlZCBvbiBieSB0aGUgdGltZSBVbmRvIGlzIGNsaWNrZWQsXG4gIC8vIHNvbWV0aGluZyBlbHNlIGNoYW5nZWQgdGhlIHNldHRpbmdzIGluIGJldHdlZW4gLSByZXN0b3JpbmcgdGhlIHNuYXBzaG90XG4gIC8vIHdvdWxkIHNpbGVudGx5IHJldmVydCB0aGF0IHRvby5cbiAgY3VycmVudCA9IHsgdG9rZW4sIHJldmlzaW9uOiBwbHVnaW4uc2V0dGluZ3NSZXZpc2lvbiA/PyAwLCBzbmFwc2hvdCB9O1xuICBjb25zdCBmcmFnbWVudCA9IGNyZWF0ZUZyYWdtZW50KChmKSA9PiB7XG4gICAgZi5hcHBlbmRUZXh0KG1lc3NhZ2UpO1xuICAgIC8vIE9ic2lkaWFuIGhpZGVzIHRoZSBub3RpY2Ugb24gYW55IGNsaWNrIGluc2lkZSBpdCwgdGhlIGJ1dHRvbiBpbmNsdWRlZC5cbiAgICBjb25zdCBidXR0b24gPSBmLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgY2xzOiBcInR5cC11bmRvLWJ1dHRvblwiLCB0ZXh0OiBcIlVuZG9cIiB9KTtcbiAgICBidXR0b24uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHVuZG8ocGx1Z2luLCB0b2tlbikpO1xuICB9KTtcbiAgbmV3IE5vdGljZShmcmFnbWVudCwgVU5ET19OT1RJQ0VfRFVSQVRJT04pO1xufVxuXG5hc3luYyBmdW5jdGlvbiB1bmRvKHBsdWdpbiwgdG9rZW4pIHtcbiAgaWYgKGN1cnJlbnQ/LnRva2VuICE9PSB0b2tlbiB8fCAocGx1Z2luLnNldHRpbmdzUmV2aXNpb24gPz8gMCkgIT09IGN1cnJlbnQucmV2aXNpb24pIHtcbiAgICBuZXcgTm90aWNlKFwiQ2FuJ3QgdW5kbyBcdTIwMTMgdGhlIHNldHRpbmdzIGhhdmUgY2hhbmdlZCBzaW5jZS5cIik7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHsgc25hcHNob3QgfSA9IGN1cnJlbnQ7XG4gIGN1cnJlbnQgPSBudWxsO1xuICAvLyBJbiBwbGFjZSwgc28gZXZlcnkgcmVmZXJlbmNlIHRvIHBsdWdpbi5zZXR0aW5ncyBzdGF5cyB2YWxpZC4gVGhlIHNuYXBzaG90XG4gIC8vIGlzIHVzZWQgb25seSBvbmNlLCBubyBzZWNvbmQgY29weSBuZWVkZWQuXG4gIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKHBsdWdpbi5zZXR0aW5ncykpIGRlbGV0ZSBwbHVnaW4uc2V0dGluZ3Nba2V5XTtcbiAgT2JqZWN0LmFzc2lnbihwbHVnaW4uc2V0dGluZ3MsIHNuYXBzaG90KTtcbiAgYXdhaXQgcGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAvLyBUaGUgZnVsbCByZWZyZXNoIG9uIHB1cnBvc2U6IGl0IHJlLXJlbmRlcnMgdGhlIFRZUC1QYW5lLCB3aG9zZSBmcm9udG1hdHRlclxuICAvLyBlZGl0b3JzIG9ubHkgcmVhZCB0aGUgc2V0dGluZ3Mgd2hlbiBtb3VudGVkLlxuICBwbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyBzbmFwc2hvdFNldHRpbmdzLCBvZmZlclVuZG8gfTtcbiIsICJjb25zdCB7IG1vbWVudCB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuXG4vLyBBIHNob3J0Y3V0IGlzIGEgdmFsdWUgY29tcHV0ZWQgb25seSB3aGVuIGEgbm90ZSBpcyBjcmVhdGVkLiBJdCBpcyBzdG9yZWRcbi8vIE5FWFQgVE8gdGhlIHByb3BlcnR5J3MgZnJvbnRtYXR0ZXIgdmFsdWUsIG5vdCBpbiBpdDogaW5cbi8vIHNldHRpbmdzLnR5cFNob3J0Y3V0c1tUWVBdW2tleV0gZm9yIHRoZSBUWVAtRnJvbnRtYXR0ZXIsIG9yIGluIHRoZSBzaG9ydGN1dHNcbi8vIG9iamVjdCBvZiBhIFN1YnR5cCBibG9jayAoc2VlIHN1YnR5cHMuanMpOlxuLy8gICB7IG5hbWU6IFwidG9kYXlcIiB9ICAgICAgICAgICAgLSBmaXhlZCB0b2tlbiwgcmVzb2x2ZWQgYnkgdGhlIHBsdWdpblxuLy8gICB7IG5hbWU6IFwidHAuPHNjcmlwdD5cIiB9ICAgICAgLSBUZW1wbGF0ZXIgc2NyaXB0LCBvbmx5IFRZUC5qcyBjYW4gcmVzb2x2ZSBpdFxuLy8gICB7IG5hbWU6IFwidHAuPHNjcmlwdD5cIiwgYXJnczogeyBmb2xkZXI6IFwiTGl0ZXJhdHVyXCIsIHllYXI6IDIwMjQgfSB9XG4vLyAgICAgLSB0aGUgc2FtZSB3aXRoIGFyZ3VtZW50cy4gVGhlIHNjcmlwdCBkZWNsYXJlcyB0aGUgcGFyYW1ldGVyIG5hbWVzIGluXG4vLyAgICAgICBpdHMgQHR5cC1zaG9ydGN1dCBtYXJrZXIgKHNlZSBzaG9ydGN1dC1zY3JpcHRzLmpzKTsgVFlQLmpzIHBhc3NlcyB0aGVcbi8vICAgICAgIG9iamVjdCBvbiBhcyBjdHguYXJncy4gRml4ZWQgdG9rZW5zIG5ldmVyIGhhdmUgYXJndW1lbnRzLlxuLy9cbi8vIFdoeSBuZXh0IHRvIHRoZSB2YWx1ZTogT2JzaWRpYW4gcGlja3MgYSByb3cncyBpbnB1dCBmcm9tIHRoZSBwcm9wZXJ0eSB0eXBlXG4vLyBpbiB0eXBlcy5qc29uLiBBIGRhdGUvbnVtYmVyL2NoZWNrYm94IHByb3BlcnR5IGNhbid0IHRha2UgYSB0b2tlbiBsaWtlXG4vLyBcInt7dG9kYXl9fVwiIGF0IGFsbCwgYSBzdG9yZWQgb25lIHRyaWdnZXJzIHRoZSBcIlR5cGUgbWlzbWF0Y2hcIiB3YXJuaW5nLCBhbmRcbi8vIHRoZSBsaXN0IHdpZGdldCBzaWxlbnRseSB0dXJucyBhIHN0cmluZyBpbnRvIGFuIGFycmF5IG9uIGZpcnN0IGVkaXQuIEtlcHRcbi8vIGFwYXJ0LCB0aGUgdmFsdWUgc3RheXMgdHlwZS1jbGVhbiBhbmQgdGhlIG5hdGl2ZSB3aWRnZXQgdW50b3VjaGVkLlxuLy9cbi8vIFRoZSBmcm9udG1hdHRlciB2YWx1ZSBzdGF5cyBhbmQgc2VydmVzIGFzIEZBTExCQUNLOiBpZiB0aGUgc2NyaXB0IGlzIG1pc3Npbmdcbi8vIG9yIHRocm93cywgVFlQLmpzIHdyaXRlcyBpdCBpbnN0ZWFkIG9mIGFuIGVtcHR5IHZhbHVlLiBBIHNjcmlwdCB0aGF0XG4vLyBkZWxpYmVyYXRlbHkgcmV0dXJucyBudWxsL1wiXCIgKGUuZy4gRVNDIGluIGEgcGlja2VyKSBpcyBub3QgYSBmYWlsdXJlIGFuZFxuLy8gbGVhdmVzIHRoZSBwcm9wZXJ0eSBlbXB0eS5cblxuLy8gVG9rZW5zIHRoZSBwbHVnaW4gcmVzb2x2ZXMgaXRzZWxmLCB3aXRob3V0IFRlbXBsYXRlciAtIHNvIGdldFR5cERlZmF1bHRzKClcbi8vIGZpbGxzIHRoZW0gaW4uIFJlc29sdmVkIG9uIGVhY2ggY2FsbCwgbm90IHdoZW4gc2V0LCBzbyBcInRvZGF5XCIgaXMgdGhlIGRheVxuLy8gdGhlIG5vdGUgaXMgY3JlYXRlZC5cbmNvbnN0IEZJWEVEX1NIT1JUQ1VUUyA9IFtcbiAge1xuICAgIG5hbWU6IFwidG9kYXlcIixcbiAgICBkZXNjcmlwdGlvbjogXCJUb2RheSdzIGRhdGUgKFlZWVktTU0tREQpXCIsXG4gICAgcmVzb2x2ZTogKCkgPT4gbW9tZW50KCkuZm9ybWF0KFwiWVlZWS1NTS1ERFwiKSxcbiAgfSxcbiAge1xuICAgIG5hbWU6IFwibm93XCIsXG4gICAgZGVzY3JpcHRpb246IFwiQ3VycmVudCBkYXRlIGFuZCB0aW1lIChZWVlZLU1NLUREIEhIOm1tKVwiLFxuICAgIHJlc29sdmU6ICgpID0+IG1vbWVudCgpLmZvcm1hdChcIllZWVktTU0tREQgSEg6bW1cIiksXG4gIH0sXG4gIHtcbiAgICAvLyBUaGUgZmlsZSdzIGNyZWF0aW9uIGRhdGUgKGZpbGUuc3RhdC5jdGltZSksIG5vdCB0aGUgY2FsbCB0aW1lOyBmYWxsc1xuICAgIC8vIGJhY2sgdG8gbm93IHdpdGhvdXQgYSBmaWxlLlxuICAgIG5hbWU6IFwiY3JlYXRlZFwiLFxuICAgIGRlc2NyaXB0aW9uOiBcIlRoZSBmaWxlJ3MgY3JlYXRpb24gZGF0ZSAoWVlZWS1NTS1ERClcIixcbiAgICByZXNvbHZlOiAoZmlsZSkgPT4gbW9tZW50KGZpbGU/LnN0YXQ/LmN0aW1lID8/IERhdGUubm93KCkpLmZvcm1hdChcIllZWVktTU0tRERcIiksXG4gIH0sXG5dO1xuXG4vLyBTY3JpcHQgc2hvcnRjdXRzIGNhcnJ5IHRoaXMgcHJlZml4IHNvIGEgc2NyaXB0IGNhbiBuZXZlciBjb2xsaWRlIHdpdGggYVxuLy8gZml4ZWQgdG9rZW4sIG5vdCBldmVuIGEgXCJ0b2RheS5qc1wiIGluIHRoZSBzY3JpcHQgZm9sZGVyLlxuY29uc3QgU0NSSVBUX1BSRUZJWCA9IFwidHAuXCI7XG5cbmZ1bmN0aW9uIGZpbmRGaXhlZFNob3J0Y3V0KG5hbWUpIHtcbiAgcmV0dXJuIEZJWEVEX1NIT1JUQ1VUUy5maW5kKChzaG9ydGN1dCkgPT4gc2hvcnRjdXQubmFtZSA9PT0gbmFtZSkgPz8gbnVsbDtcbn1cblxuLy8gU2NyaXB0IG5hbWUgb2YgYSBcInRwLjxzY3JpcHQ+XCIgc2hvcnRjdXQsIG90aGVyd2lzZSBudWxsLiBUaGUgc2NyaXB0IG5hbWUgaXNcbi8vIHRoZSBmaWxlIG5hbWUgd2l0aG91dCBcIi5qc1wiLCBzbyB1bWxhdXRzLCBcIi1cIiBhbmQgc3BhY2VzIGFyZSBhbGxvd2VkLlxuZnVuY3Rpb24gc2NyaXB0TmFtZU9mKG5hbWUpIHtcbiAgcmV0dXJuIHR5cGVvZiBuYW1lID09PSBcInN0cmluZ1wiICYmIG5hbWUuc3RhcnRzV2l0aChTQ1JJUFRfUFJFRklYKSA/IG5hbWUuc2xpY2UoU0NSSVBUX1BSRUZJWC5sZW5ndGgpIDogbnVsbDtcbn1cblxuZnVuY3Rpb24gaXNTY3JpcHRTaG9ydGN1dChyZWNvcmQpIHtcbiAgcmV0dXJuIHNjcmlwdE5hbWVPZihyZWNvcmQ/Lm5hbWUpICE9PSBudWxsO1xufVxuXG4vLyBEaXNwbGF5IGZvcm0gaW4gdGhlIHByb3BlcnR5IHJvdyAoY2hpcCkgYW5kIHRoZSBwaWNrZXI6IHRoZSBiYXJlIG5hbWUgcGx1c1xuLy8gaXRzIGFyZ3VtZW50cy4gVGhlIGNoaXAgaXRzZWxmIG1hcmtzIGl0IGFzIGEgc2hvcnRjdXQsIHNvIG5vIGJyYWNlcy5cbmZ1bmN0aW9uIHNob3J0Y3V0TGFiZWwocmVjb3JkKSB7XG4gIGlmICghcmVjb3JkPy5uYW1lKSByZXR1cm4gXCJcIjtcbiAgY29uc3QgdmFsdWVzID0gT2JqZWN0LnZhbHVlcyhyZWNvcmQuYXJncyA/PyB7fSkuZmlsdGVyKCh2YWx1ZSkgPT4gdmFsdWUgIT09IHVuZGVmaW5lZCk7XG4gIHJldHVybiB2YWx1ZXMubGVuZ3RoID4gMCA/IGAke3JlY29yZC5uYW1lfTogJHt2YWx1ZXMuam9pbihcIiwgXCIpfWAgOiByZWNvcmQubmFtZTtcbn1cblxuLy8gQ29udmVydHMgYSB0eXBlZCBhcmd1bWVudCB0byB0aGUgdHlwZSBpdCBvYnZpb3VzbHkgbWVhbnMsIHNvIGEgc2NyaXB0IGdldHNcbi8vIDUgYXMgYSBudW1iZXIgYW5kIHRydWUgYXMgYSBib29sZWFuIChtYXR0ZXJzIHdoZW4gdGhlIHZhbHVlIGxhbmRzIGluIGFcbi8vIG51bWJlciBwcm9wZXJ0eSkuIERlbGliZXJhdGVseSB0aGVzZSBmZXcgY2FzZXMgaW5zdGVhZCBvZiBKU09OLnBhcnNlLCB3aGljaFxuLy8gd291bGQgZmFpbCBvbiBcIkxpdGVyYXR1clwiLiBBbiBlbXB0eSBmaWVsZCBtZWFucyBcIm5vdCBzZXRcIiAodW5kZWZpbmVkKSBhbmRcbi8vIGRyb3BzIG91dCBvZiB0aGUgYXJndW1lbnQgb2JqZWN0LCBzbyBcImFyZ3MueWVhciA/PyBmYWxsYmFja1wiIHdvcmtzLlxuZnVuY3Rpb24gcGFyc2VBcmdWYWx1ZShyYXcpIHtcbiAgY29uc3QgdGV4dCA9IFN0cmluZyhyYXcgPz8gXCJcIikudHJpbSgpO1xuICBpZiAodGV4dCA9PT0gXCJcIikgcmV0dXJuIHVuZGVmaW5lZDtcbiAgaWYgKHRleHQgPT09IFwidHJ1ZVwiKSByZXR1cm4gdHJ1ZTtcbiAgaWYgKHRleHQgPT09IFwiZmFsc2VcIikgcmV0dXJuIGZhbHNlO1xuICBpZiAodGV4dCA9PT0gXCJudWxsXCIpIHJldHVybiBudWxsO1xuICBpZiAoL14tP1xcZCsoPzpcXC5cXGQrKT8kLy50ZXN0KHRleHQpKSByZXR1cm4gTnVtYmVyKHRleHQpO1xuICByZXR1cm4gdGV4dDtcbn1cblxuLy8gUGFyYW1ldGVyIG5hbWVzIHdob3NlIHZhbHVlcyB0aGUgcGx1Z2luIG9yIFRZUC5qcyBhbHJlYWR5IGtub3c7IHRoZXkgYXJlXG4vLyBmaWxsZWQgaW4gYXQgY2FsbCB0aW1lLCBub3QgYXNrZWQgZm9yOlxuLy8gICBuZXdGaWxlICB0aGUgbmV3bHkgY3JlYXRlZCBub3RlXG4vLyAgIGN0eCAgICAgIHRoZSBjb250ZXh0IHsgdHlwLCBzdWJ0eXAsIGtleSwgdmFsdWVzLCBhZnRlciwgYXJncyB9XG4vLyAgIGtleSAgICAgIHRoZSBwcm9wZXJ0eSB0aGUgc2hvcnRjdXQgc2l0cyBvbiwgc28gYSBzY3JpcHQgbGlrZSByZWxhdGlvbi5qc1xuLy8gICAgICAgICAgICBnZXRzIHRoZSByaWdodCBvbmUgd2hlcmV2ZXIgdGhlIHNob3J0Y3V0IGlzIHVzZWRcbi8vIFwidHBcIiBhbHdheXMgY29tZXMgZmlyc3QgYW5kIG5lZWRuJ3QgYmUgZGVjbGFyZWQ7IGlmIGl0IGlzLCBpdCBpcyBza2lwcGVkLlxuY29uc3QgUkVTRVJWRURfUEFSQU1TID0gW1wibmV3RmlsZVwiLCBcImN0eFwiLCBcImtleVwiXTtcblxuLy8gUGFyYW1ldGVycyB0aGF0IGdldCBhbiBpbnB1dCBmaWVsZDogZXZlcnl0aGluZyBub3QgcmVzZXJ2ZWQuIHBhcmFtcyA9PT0gbnVsbFxuLy8gKG1hcmtlciB3aXRob3V0IHBhcmVudGhlc2VzKSBtZWFucyB0aGUgY2xhc3NpYyBjYWxsLCBhbHNvIHdpdGhvdXQgZmllbGRzLlxuZnVuY3Rpb24gaW5wdXRQYXJhbXMocGFyYW1zKSB7XG4gIHJldHVybiAocGFyYW1zID8/IFtdKS5maWx0ZXIoKG5hbWUpID0+IG5hbWUgIT09IFwidHBcIiAmJiAhUkVTRVJWRURfUEFSQU1TLmluY2x1ZGVzKG5hbWUpKTtcbn1cblxuLy8gSW5wdXRzIChvbmUgc3RyaW5nIHBlciBwYXJhbWV0ZXIpIHRvIHRoZSBzdG9yZWQgYXJndW1lbnQgb2JqZWN0LCBpbiB0aGVcbi8vIGRlY2xhcmVkIG9yZGVyIHNvIHNob3J0Y3V0TGFiZWwoKSBzaG93cyB0aGVtIHRoYXQgd2F5LiBFbXB0eSBmaWVsZHMgYXJlIGxlZnRcbi8vIG91dC5cbmZ1bmN0aW9uIGJ1aWxkQXJncyhwYXJhbXMsIGlucHV0cykge1xuICBjb25zdCBhcmdzID0ge307XG4gIGZvciAoY29uc3QgbmFtZSBvZiBpbnB1dFBhcmFtcyhwYXJhbXMpKSB7XG4gICAgY29uc3QgdmFsdWUgPSBwYXJzZUFyZ1ZhbHVlKGlucHV0c1tuYW1lXSk7XG4gICAgaWYgKHZhbHVlICE9PSB1bmRlZmluZWQpIGFyZ3NbbmFtZV0gPSB2YWx1ZTtcbiAgfVxuICByZXR1cm4gYXJncztcbn1cblxuLy8gQnVpbGRzIHRoZSBhcmd1bWVudHMgZm9yIGYodHAsIC4uLmhlcmUpIGZyb20gdGhlIGRlY2xhcmVkIHBhcmFtZXRlciBsaXN0LlxuLy8gQ2FsbGVkIGZyb20gVFlQLmpzLCB0aGUgb25seSBwbGFjZSB0aGF0IGtub3dzIG5ld0ZpbGUgYW5kIGN0eC5cbi8vXG4vLyBXaXRob3V0IHBhcmVudGhlc2VzIChwYXJhbXMgPT09IG51bGwpIGl0IHN0YXlzIHRoZSBjbGFzc2ljIGYodHAsIG5ld0ZpbGUsXG4vLyBjdHgpLiBPdGhlcndpc2UgZWFjaCBlbnRyeSByZXNvbHZlcyB0byB0aGUgcGFzc2VkIHZhbHVlIChyZXNlcnZlZCBuYW1lcykgb3Jcbi8vIHRoZSB0eXBlZCBhcmd1bWVudC5cbi8vXG4vLyBBIGRvdHRlZCBuYW1lIChcIm9wdGlvbnMudHlwXCIpIGlzIGEgRklFTEQgb2YgYW4gb2JqZWN0IGFyZ3VtZW50OiBhbGxcbi8vIFwib3B0aW9ucy4qXCIgY29sbGVjdCBpbnRvIG9uZSBvYmplY3QgYXQgdGhlIHBvc2l0aW9uIG9mIHRoZSBmaXJzdCBvbmUuIFRoaXNcbi8vIHNlcnZlcyBzY3JpcHRzIHRoYXQgdGFrZSBhbiBvcHRpb25zIG9iamVjdCB3aXRob3V0IHR5cGluZyBKU09OLiBPbmUgbGV2ZWxcbi8vIG9ubHkgLSBcImEuYi5jXCIgZ2l2ZXMgYSBmaWVsZCBsaXRlcmFsbHkgbmFtZWQgXCJiLmNcIi5cbmZ1bmN0aW9uIHJlc29sdmVDYWxsQXJncyhwYXJhbXMsIGFyZ3MsIHJlc2VydmVkID0ge30pIHtcbiAgaWYgKHBhcmFtcyA9PT0gbnVsbCB8fCBwYXJhbXMgPT09IHVuZGVmaW5lZCkgcmV0dXJuIFtyZXNlcnZlZC5uZXdGaWxlLCByZXNlcnZlZC5jdHhdO1xuXG4gIGNvbnN0IGNhbGxBcmdzID0gW107XG4gIGNvbnN0IG9iamVjdEluZGV4ID0gbmV3IE1hcCgpO1xuICBmb3IgKGNvbnN0IG5hbWUgb2YgcGFyYW1zKSB7XG4gICAgaWYgKG5hbWUgPT09IFwidHBcIikgY29udGludWU7XG4gICAgaWYgKFJFU0VSVkVEX1BBUkFNUy5pbmNsdWRlcyhuYW1lKSkge1xuICAgICAgY2FsbEFyZ3MucHVzaChyZXNlcnZlZFtuYW1lXSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgZG90ID0gbmFtZS5pbmRleE9mKFwiLlwiKTtcbiAgICBpZiAoZG90ID09PSAtMSkge1xuICAgICAgY2FsbEFyZ3MucHVzaChhcmdzPy5bbmFtZV0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IGJhc2UgPSBuYW1lLnNsaWNlKDAsIGRvdCk7XG4gICAgaWYgKCFvYmplY3RJbmRleC5oYXMoYmFzZSkpIHtcbiAgICAgIG9iamVjdEluZGV4LnNldChiYXNlLCBjYWxsQXJncy5sZW5ndGgpO1xuICAgICAgY2FsbEFyZ3MucHVzaCh7fSk7XG4gICAgfVxuICAgIGNvbnN0IHZhbHVlID0gYXJncz8uW25hbWVdO1xuICAgIGlmICh2YWx1ZSAhPT0gdW5kZWZpbmVkKSBjYWxsQXJnc1tvYmplY3RJbmRleC5nZXQoYmFzZSldW25hbWUuc2xpY2UoZG90ICsgMSldID0gdmFsdWU7XG4gIH1cbiAgcmV0dXJuIGNhbGxBcmdzO1xufVxuXG4vLyBXaGV0aGVyIHR5cGVzLmpzb24gKG9yLCBpZiB1bnNldCwgdGhlIHByb3BlcnR5J3MgdXNhZ2UpIGRlY2xhcmVzIGEgbGlzdC5cbi8vIFRoZW4gYSByZXNvbHZlZCBzaG9ydGN1dCB2YWx1ZSBpcyB3cmFwcGVkIGluIGEgb25lLWVsZW1lbnQgYXJyYXkgdG8gbWF0Y2guXG4vLyBXaXRob3V0IGFwcCAodGVzdHMpIG5vdGhpbmcgaXMgd3JhcHBlZC5cbmZ1bmN0aW9uIGlzTGlzdFByb3BlcnR5KGFwcCwga2V5KSB7XG4gIHJldHVybiBhcHA/Lm1ldGFkYXRhVHlwZU1hbmFnZXI/LmdldFR5cGVJbmZvPy4oa2V5KT8uZXhwZWN0ZWQ/LnR5cGUgPT09IFwibXVsdGl0ZXh0XCI7XG59XG5cbi8vIENvcHkgb2YgZnJvbnRtYXR0ZXIgaW4gd2hpY2ggZXZlcnkga2V5IHdpdGggYSBzaG9ydGN1dCBjYXJyaWVzIGl0cyB2YWx1ZTpcbi8vICAgLSBmaXhlZCB0b2tlbiAtPiByZXNvbHZlZCAod3JhcHBlZCBmb3IgbGlzdCBwcm9wZXJ0aWVzKSxcbi8vICAgLSBcInRwLjxzY3JpcHQ+XCIgLT4gbnVsbDsgb25seSBUZW1wbGF0ZXIgY2FuIHJlc29sdmUgaXQsIFRZUC5qcyBnZXRzIHRoZXNlXG4vLyAgICAga2V5cyBmcm9tIGdldFR5cFNob3J0Y3V0cygpIGFuZCBmaWxscyB0aGVtIGluIGl0c2VsZi5cbi8vIEtleXMgd2l0aG91dCBhIHNob3J0Y3V0IHN0YXkgYXMgdGhleSBhcmUuIFRoZSBzdG9yZWQgdmFsdWUgb2YgYSBrZXkgV0lUSCBhXG4vLyBzaG9ydGN1dCBpcyBvbmx5IG92ZXJyaWRkZW4gaGVyZSwgbmV2ZXIgZGVsZXRlZCAtIGl0IGlzIHRoZSBmYWxsYmFjay5cbmZ1bmN0aW9uIHJlc29sdmVTaG9ydGN1dHMoZnJvbnRtYXR0ZXIsIHNob3J0Y3V0cywgeyBmaWxlLCBhcHAgfSA9IHt9KSB7XG4gIGNvbnN0IHJlc29sdmVkID0ge307XG4gIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGZyb250bWF0dGVyKSkge1xuICAgIGNvbnN0IHJlY29yZCA9IHNob3J0Y3V0cz8uW2tleV07XG4gICAgY29uc3QgZml4ZWQgPSByZWNvcmQgPyBmaW5kRml4ZWRTaG9ydGN1dChyZWNvcmQubmFtZSkgOiBudWxsO1xuICAgIGlmIChmaXhlZCkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gZml4ZWQucmVzb2x2ZShmaWxlKTtcbiAgICAgIHJlc29sdmVkW2tleV0gPSBpc0xpc3RQcm9wZXJ0eShhcHAsIGtleSkgPyBbcmVzdWx0XSA6IHJlc3VsdDtcbiAgICB9IGVsc2UgaWYgKGlzU2NyaXB0U2hvcnRjdXQocmVjb3JkKSkge1xuICAgICAgcmVzb2x2ZWRba2V5XSA9IG51bGw7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlc29sdmVkW2tleV0gPSB2YWx1ZTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHJlc29sdmVkO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgRklYRURfU0hPUlRDVVRTLFxuICBTQ1JJUFRfUFJFRklYLFxuICBmaW5kRml4ZWRTaG9ydGN1dCxcbiAgc2NyaXB0TmFtZU9mLFxuICBpc1NjcmlwdFNob3J0Y3V0LFxuICBzaG9ydGN1dExhYmVsLFxuICBwYXJzZUFyZ1ZhbHVlLFxuICBidWlsZEFyZ3MsXG4gIGlucHV0UGFyYW1zLFxuICByZXNvbHZlQ2FsbEFyZ3MsXG4gIFJFU0VSVkVEX1BBUkFNUyxcbiAgcmVzb2x2ZVNob3J0Y3V0cyxcbn07XG4iLCAiY29uc3QgeyBGdXp6eVN1Z2dlc3RNb2RhbCwgTW9kYWwsIFNldHRpbmcsIHJlbmRlck1hdGNoZXMgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgRklYRURfU0hPUlRDVVRTLCBTQ1JJUFRfUFJFRklYLCBidWlsZEFyZ3MsIGlucHV0UGFyYW1zIH0gPSByZXF1aXJlKFwiLi9zaG9ydGN1dHNcIik7XG5jb25zdCB7IHBpY2tlckluc3RydWN0aW9ucyB9ID0gcmVxdWlyZShcIi4vdHlwLXV0aWxzXCIpO1xuXG4vLyBMaXN0IGxhYmVsOiB0aGUgbmFtZSwgcGx1cyB0aGUgZGVjbGFyZWQgcGFyYW1ldGVyIG5hbWVzIGZvciBhIHNjcmlwdCwgc29cbi8vIHRoZSBwaWNrZXIgYWxyZWFkeSBzaG93cyB0aGF0IChhbmQgaG93KSBpdCB0YWtlcyBhcmd1bWVudHMuXG5mdW5jdGlvbiBpdGVtTGFiZWwoaXRlbSkge1xuICByZXR1cm4gaXRlbS5wYXJhbXMgPyBgJHtpdGVtLm5hbWV9KCR7aXRlbS5wYXJhbXMuam9pbihcIiwgXCIpfSlgIDogaXRlbS5uYW1lO1xufVxuXG4vLyBQaWNrcyBhIHNob3J0Y3V0IGZvciBhIFRZUC1Gcm9udG1hdHRlciBwcm9wZXJ0eSAoYnV0dG9uIG9yIGNoaXAgaW4gdGhlIHJvdyxcbi8vIHNlZSB0eXAtZnJvbnRtYXR0ZXItZWRpdG9yLmpzKS4gU2VhcmNoYWJsZSwgYW5kIHNjcmlwdHMgc2hvdyB0aGUgZGVzY3JpcHRpb25cbi8vIGZyb20gdGhlaXIgQHR5cC1zaG9ydGN1dCBtYXJrZXIuIE5ldmVyIGZyZWUgdGV4dDogdGhlIGxpc3QgaXMgdGhlIHNvdXJjZSBvZlxuLy8gdHJ1dGgsIHNvIGEgdHlwbyBpbiBhIHNjcmlwdCBuYW1lIGlzIGltcG9zc2libGUuXG5jbGFzcyBTaG9ydGN1dFBpY2tlck1vZGFsIGV4dGVuZHMgRnV6enlTdWdnZXN0TW9kYWwge1xuICBjb25zdHJ1Y3RvcihhcHAsIGtleSwgaXRlbXMsIHJlc29sdmUpIHtcbiAgICBzdXBlcihhcHApO1xuICAgIHRoaXMuaXRlbXMgPSBpdGVtcztcbiAgICB0aGlzLnJlc29sdmUgPSByZXNvbHZlO1xuICAgIHRoaXMuY2hvc2VuID0gZmFsc2U7XG4gICAgdGhpcy5zZXRQbGFjZWhvbGRlcihgQ2hvb3NlIHNob3J0Y3V0IGZvciBcIiR7a2V5fVwiXHUyMDI2YCk7XG4gICAgdGhpcy5zZXRJbnN0cnVjdGlvbnMocGlja2VySW5zdHJ1Y3Rpb25zKCkpO1xuICB9XG5cbiAgZ2V0SXRlbXMoKSB7XG4gICAgcmV0dXJuIHRoaXMuaXRlbXM7XG4gIH1cblxuICAvLyBGdXp6eSBzZWFyY2ggYWxzbyBjb3ZlcnMgdGhlIGRlc2NyaXB0aW9uOiBcImNyZWF0aW9uXCIgZmluZHMgXCJjcmVhdGVkXCIuXG4gIGdldEl0ZW1UZXh0KGl0ZW0pIHtcbiAgICBjb25zdCBsYWJlbCA9IGl0ZW1MYWJlbChpdGVtKTtcbiAgICByZXR1cm4gaXRlbS5kZXNjcmlwdGlvbiA/IGAke2xhYmVsfSAke2l0ZW0uZGVzY3JpcHRpb259YCA6IGxhYmVsO1xuICB9XG5cbiAgLy8gTWF0Y2hlZCBjaGFyYWN0ZXJzIG1hcmtlZCBsaWtlIGluIE9ic2lkaWFuJ3Mgb3duIHN1Z2dlc3RlcnMuIFRoZSByYW5nZXNcbiAgLy8gcmVmZXIgdG8gdGhlIHdob2xlIHNlYXJjaCB0ZXh0IChnZXRJdGVtVGV4dCksIHNvIHRoZSBkZXNjcmlwdGlvbidzIGFyZVxuICAvLyBzaGlmdGVkIGJhY2sgYnkgdGhlIGxhYmVsIGFuZCB0aGUgc3BhY2UgYmVmb3JlIGl0LlxuICByZW5kZXJTdWdnZXN0aW9uKG1hdGNoLCBlbCkge1xuICAgIGNvbnN0IGl0ZW0gPSBtYXRjaC5pdGVtO1xuICAgIGNvbnN0IGxhYmVsID0gaXRlbUxhYmVsKGl0ZW0pO1xuICAgIGNvbnN0IG1hdGNoZXMgPSBtYXRjaC5tYXRjaD8ubWF0Y2hlcz8ubGVuZ3RoID8gbWF0Y2gubWF0Y2gubWF0Y2hlcyA6IG51bGw7XG4gICAgZWwuYWRkQ2xhc3MoXCJ0eXAtc2hvcnRjdXQtc3VnZ2VzdGlvblwiKTtcbiAgICByZW5kZXJNYXRjaGVzKGVsLmNyZWF0ZUVsKFwiY29kZVwiLCB7IGNsczogXCJ0eXAtc2hvcnRjdXQtc3VnZ2VzdGlvbi1uYW1lXCIgfSksIGxhYmVsLCBtYXRjaGVzLCAwKTtcbiAgICBpZiAoaXRlbS5kZXNjcmlwdGlvbikge1xuICAgICAgcmVuZGVyTWF0Y2hlcyhlbC5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1zaG9ydGN1dC1zdWdnZXN0aW9uLWRlc2NcIiB9KSwgaXRlbS5kZXNjcmlwdGlvbiwgbWF0Y2hlcywgLShsYWJlbC5sZW5ndGggKyAxKSk7XG4gICAgfVxuICB9XG5cbiAgLy8gT2JzaWRpYW4ncyBzZWxlY3RTdWdnZXN0aW9uKCkgY2FsbHMgY2xvc2UoKSBCRUZPUkUgb25DaG9vc2VJdGVtKCksIHNvXG4gIC8vIFwiY2hvc2VuXCIgbXVzdCBiZSBzZXQgaGVyZSAtIG90aGVyd2lzZSBvbkNsb3NlKCkgcmVzb2x2ZXMgd2l0aCBudWxsIGZpcnN0XG4gIC8vIGFuZCB0aGUgY2hvaWNlIGlzIGxvc3QuIFNhbWUgYXMgaW4gVHlwUGlja2VyTW9kYWwgKHR5cC1waWNrZXIuanMpLlxuICBzZWxlY3RTdWdnZXN0aW9uKGl0ZW0sIGV2dCkge1xuICAgIHRoaXMuY2hvc2VuID0gdHJ1ZTtcbiAgICBzdXBlci5zZWxlY3RTdWdnZXN0aW9uKGl0ZW0sIGV2dCk7XG4gIH1cblxuICBvbkNob29zZUl0ZW0oaXRlbSkge1xuICAgIHRoaXMucmVzb2x2ZShpdGVtKTtcbiAgfVxuXG4gIG9uQ2xvc2UoKSB7XG4gICAgc3VwZXIub25DbG9zZSgpO1xuICAgIGlmICghdGhpcy5jaG9zZW4pIHRoaXMucmVzb2x2ZShudWxsKTtcbiAgfVxufVxuXG4vLyBBc2tzIGZvciB0aGUgYXJndW1lbnRzIG9mIGEgc2NyaXB0IHRoYXQgZGVjbGFyZXMgc29tZTogb25lIGRpYWxvZyB3aXRoIGFsbFxuLy8gZmllbGRzLCBuYW1lZCBhZnRlciB0aGUgc2NyaXB0J3MgcGFyYW1ldGVycyBhbmQgcHJlZmlsbGVkIHdpdGggdGhlIHN0b3JlZFxuLy8gdmFsdWVzLCBzbyBwaWNraW5nIHRoZSBzYW1lIHNjcmlwdCBhZ2FpbiBpcyBob3cgc2luZ2xlIHZhbHVlcyBnZXQgZml4ZWQuXG4vLyBBbiBlbXB0eSBmaWVsZCBtZWFucyBcIm5vdCBzZXRcIiAoc2VlIGJ1aWxkQXJncyk7IHRoZXJlIGlzIG5vIHZhbGlkYXRpb24sXG4vLyBzaW5jZSBvbmx5IHRoZSBzY3JpcHQga25vd3Mgd2hhdCBpdCBuZWVkcy5cbmNsYXNzIFNob3J0Y3V0QXJnc01vZGFsIGV4dGVuZHMgTW9kYWwge1xuICBjb25zdHJ1Y3RvcihhcHAsIGl0ZW0sIGV4aXN0aW5nLCByZXNvbHZlKSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgICB0aGlzLml0ZW0gPSBpdGVtO1xuICAgIHRoaXMucmVzb2x2ZSA9IHJlc29sdmU7XG4gICAgdGhpcy5maWVsZHMgPSBpbnB1dFBhcmFtcyhpdGVtLnBhcmFtcyk7XG4gICAgdGhpcy5pbnB1dHMgPSB7fTtcbiAgICBmb3IgKGNvbnN0IG5hbWUgb2YgdGhpcy5maWVsZHMpIHtcbiAgICAgIGNvbnN0IHZhbHVlID0gZXhpc3Rpbmc/LltuYW1lXTtcbiAgICAgIHRoaXMuaW5wdXRzW25hbWVdID0gdmFsdWUgPT09IHVuZGVmaW5lZCB8fCB2YWx1ZSA9PT0gbnVsbCA/IFwiXCIgOiBTdHJpbmcodmFsdWUpO1xuICAgIH1cbiAgICB0aGlzLmNvbmZpcm1lZCA9IGZhbHNlO1xuICB9XG5cbiAgb25PcGVuKCkge1xuICAgIHRoaXMudGl0bGVFbC5zZXRUZXh0KGBBcmd1bWVudHMgZm9yICR7dGhpcy5pdGVtLm5hbWV9YCk7XG4gICAgaWYgKHRoaXMuaXRlbS5kZXNjcmlwdGlvbikge1xuICAgICAgdGhpcy5jb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1zaG9ydGN1dC1hcmdzLWRlc2NcIiwgdGV4dDogdGhpcy5pdGVtLmRlc2NyaXB0aW9uIH0pO1xuICAgIH1cbiAgICBmb3IgKGNvbnN0IG5hbWUgb2YgdGhpcy5maWVsZHMpIHtcbiAgICAgIG5ldyBTZXR0aW5nKHRoaXMuY29udGVudEVsKS5zZXROYW1lKG5hbWUpLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHRcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5pbnB1dHNbbmFtZV0pXG4gICAgICAgICAgLm9uQ2hhbmdlKCh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5pbnB1dHNbbmFtZV0gPSB2YWx1ZTtcbiAgICAgICAgICB9KVxuICAgICAgICAgIC8vIEVudGVyIHN1Ym1pdHMsIGxpa2UgT2JzaWRpYW4ncyBvd24gcmVuYW1lIGRpYWxvZ3MuXG4gICAgICAgICAgLmlucHV0RWwuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgKGV2ZW50KSA9PiB7XG4gICAgICAgICAgICBpZiAoZXZlbnQua2V5ID09PSBcIkVudGVyXCIgJiYgIWV2ZW50LmlzQ29tcG9zaW5nKSB7XG4gICAgICAgICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgICAgIHRoaXMuc3VibWl0KCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSlcbiAgICAgICk7XG4gICAgfVxuICAgIG5ldyBTZXR0aW5nKHRoaXMuY29udGVudEVsKS5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgIGJ1dHRvblxuICAgICAgICAuc2V0QnV0dG9uVGV4dChcIkFwcGx5XCIpXG4gICAgICAgIC5zZXRDdGEoKVxuICAgICAgICAub25DbGljaygoKSA9PiB0aGlzLnN1Ym1pdCgpKVxuICAgICk7XG4gIH1cblxuICBzdWJtaXQoKSB7XG4gICAgdGhpcy5jb25maXJtZWQgPSB0cnVlO1xuICAgIHRoaXMuY2xvc2UoKTtcbiAgfVxuXG4gIG9uQ2xvc2UoKSB7XG4gICAgdGhpcy5jb250ZW50RWwuZW1wdHkoKTtcbiAgICAvLyBFU0Mgb3IgYSBjbGljayBvdXRzaWRlIGtlZXBzIHRoZSBjdXJyZW50IHNob3J0Y3V0IC0gYW4gYWNjaWRlbnRhbCBjbG9zZVxuICAgIC8vIG11c3Qgbm90IHNpbGVudGx5IGxvc2UgZGF0YS5cbiAgICB0aGlzLnJlc29sdmUodGhpcy5jb25maXJtZWQgPyBidWlsZEFyZ3ModGhpcy5maWVsZHMsIHRoaXMuaW5wdXRzKSA6IG51bGwpO1xuICB9XG59XG5cbi8vIE9wZW5zIHRoZSBwaWNrZXIgZm9yIHByb3BlcnR5IGBrZXlgLiBnZXRTY3JpcHRzIGlzIHRoZSBhY2Nlc3NvciBmcm9tXG4vLyByZWdpc3RlclNob3J0Y3V0U2NyaXB0cygpOyBjdXJyZW50IGlzIHRoZSBzaG9ydGN1dCBzZXQgbm93ICh0byBwcmVmaWxsIHRoZVxuLy8gYXJndW1lbnRzKS4gUmVzb2x2ZXMgd2l0aCB0aGUgbmV3IHJlY29yZCAoeyBuYW1lIH0gb3IgeyBuYW1lLCBhcmdzIH0pLCBvclxuLy8gbnVsbCBvbiBjYW5jZWwgLSBhbHNvIHdoZW4gYSBzY3JpcHQgd2FzIHBpY2tlZCBidXQgaXRzIGFyZ3VtZW50IGRpYWxvZyB3YXNcbi8vIGNhbmNlbGxlZC5cbmFzeW5jIGZ1bmN0aW9uIHBpY2tTaG9ydGN1dChhcHAsIGtleSwgZ2V0U2NyaXB0cywgY3VycmVudCA9IG51bGwpIHtcbiAgY29uc3QgaXRlbXMgPSBbXG4gICAgLi4uRklYRURfU0hPUlRDVVRTLm1hcCgoeyBuYW1lLCBkZXNjcmlwdGlvbiB9KSA9PiAoeyBuYW1lLCBkZXNjcmlwdGlvbiwgcGFyYW1zOiBudWxsIH0pKSxcbiAgICAuLi5nZXRTY3JpcHRzKCkubWFwKCh7IG5hbWUsIHBhcmFtcywgZGVzY3JpcHRpb24gfSkgPT4gKHsgbmFtZTogU0NSSVBUX1BSRUZJWCArIG5hbWUsIHBhcmFtcywgZGVzY3JpcHRpb24gfSkpLFxuICBdO1xuXG4gIGNvbnN0IGl0ZW0gPSBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gbmV3IFNob3J0Y3V0UGlja2VyTW9kYWwoYXBwLCBrZXksIGl0ZW1zLCByZXNvbHZlKS5vcGVuKCkpO1xuICBpZiAoIWl0ZW0pIHJldHVybiBudWxsO1xuICAvLyBObyBmaWVsZHMgdG8gYXNrIGZvciAoZml4ZWQgdG9rZW5zLCBvciBvbmx5IHJlc2VydmVkIG5hbWVzIGxpa2VcbiAgLy8gXCIobmV3RmlsZSlcIik6IG5vIHNlY29uZCBzdGVwLlxuICBpZiAoaW5wdXRQYXJhbXMoaXRlbS5wYXJhbXMpLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHsgbmFtZTogaXRlbS5uYW1lIH07XG5cbiAgLy8gUHJlZmlsbCBvbmx5IGZvciB0aGUgc2FtZSBzY3JpcHQ7IG9sZCB2YWx1ZXMgbWVhbiBub3RoaW5nIHRvIGFub3RoZXIgb25lLlxuICBjb25zdCBwcmVmaWxsID0gY3VycmVudD8ubmFtZSA9PT0gaXRlbS5uYW1lID8gY3VycmVudC5hcmdzIDogbnVsbDtcbiAgY29uc3QgYXJncyA9IGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiBuZXcgU2hvcnRjdXRBcmdzTW9kYWwoYXBwLCBpdGVtLCBwcmVmaWxsLCByZXNvbHZlKS5vcGVuKCkpO1xuICBpZiAoYXJncyA9PT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gIHJldHVybiBPYmplY3Qua2V5cyhhcmdzKS5sZW5ndGggPiAwID8geyBuYW1lOiBpdGVtLm5hbWUsIGFyZ3MgfSA6IHsgbmFtZTogaXRlbS5uYW1lIH07XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyBwaWNrU2hvcnRjdXQgfTtcbiIsICJjb25zdCB7IE1hcmtkb3duVmlldywgTWVudSwgV29ya3NwYWNlTGVhZiwgc2V0SWNvbiB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyBzaG9ydGN1dExhYmVsLCBzY3JpcHROYW1lT2YgfSA9IHJlcXVpcmUoXCIuL3Nob3J0Y3V0c1wiKTtcbmNvbnN0IHsgcGlja1Nob3J0Y3V0IH0gPSByZXF1aXJlKFwiLi9zaG9ydGN1dC1waWNrZXJcIik7XG5jb25zdCB7IGdldFN1YnR5cCwgZW5zdXJlU3VidHlwIH0gPSByZXF1aXJlKFwiLi9zdWJ0eXBzXCIpO1xuY29uc3QgeyBUWVBfUFJPUEVSVFksIFNVQlRZUF9QUk9QRVJUWSB9ID0gcmVxdWlyZShcIi4vdHlwLWluZGV4XCIpO1xuY29uc3QgeyBzbmFwc2hvdFNldHRpbmdzLCBvZmZlclVuZG8gfSA9IHJlcXVpcmUoXCIuL3VuZG9cIik7XG5cbi8vIE1hcmtzIHRoZSBUWVAtRnJvbnRtYXR0ZXIgZWRpdG9yJ3MgY29udGFpbmVyIHNvIHRoZSBzaG9ydGN1dCBydWxlcyBpblxuLy8gc3R5bGVzLmNzcyBhcHBseSBvbmx5IGhlcmUsIG5ldmVyIGluIHJlYWwgbm90ZXMuXG5jb25zdCBFRElUT1JfQ0xBU1MgPSBcInR5cC1mcm9udG1hdHRlci1lZGl0b3JcIjtcblxuY29uc3QgU1lTVEVNX1BST1BFUlRJRVMgPSBbVFlQX1BST1BFUlRZLnRvTG93ZXJDYXNlKCksIFNVQlRZUF9QUk9QRVJUWS50b0xvd2VyQ2FzZSgpXTtcblxuLy8gVGhlIHZhbHVlIG9mIFRZUC9TVUJUWVAgaXMgYnkgZGVmaW5pdGlvbiB0aGUgVFlQIG9yIFN1YnR5cCBuYW1lIGl0c2VsZjsgYXNcbi8vIGEgc3RhbmRhcmQgcHJvcGVydHkgaXQgd291bGQgYmUgcmVkdW5kYW50IGFuZCBjb3VsZCBzaWxlbnRseSBkcmlmdCBmcm9tIHRoZVxuLy8gcmVhbCBuYW1lIGFmdGVyIGEgcmVuYW1lLCBzbyBpdCBuZXZlciBhcHBlYXJzIGFzIGEgcm93IGhlcmUuXG4vLyBNdXRhdGVzIGluIHBsYWNlIGluc3RlYWQgb2YgcmV0dXJuaW5nIGEgY29weTogT2JzaWRpYW4ncyBwcm9wZXJ0eSBlZGl0b3Jcbi8vIHNlZW1zIHRvIHJlbHkgb24gYSBzdGFibGUgb2JqZWN0IHJlZmVyZW5jZSBpbiBzeW5jaHJvbml6ZSgpOyBhIGZyZXNoIGNvcHlcbi8vIGNhdXNlZCBhIHN0YWNrIG92ZXJmbG93IGluIGl0cyByZW5kZXJQcm9wZXJ0eSgpIHBpcGVsaW5lIG9uIGZpcnN0IHJlbmRlci5cbmZ1bmN0aW9uIHN0cmlwVHlwUHJvcGVydHkoZnJvbnRtYXR0ZXIpIHtcbiAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMoZnJvbnRtYXR0ZXIpKSB7XG4gICAgaWYgKFNZU1RFTV9QUk9QRVJUSUVTLmluY2x1ZGVzKGtleS50cmltKCkudG9Mb3dlckNhc2UoKSkpIGRlbGV0ZSBmcm9udG1hdHRlcltrZXldO1xuICB9XG4gIHJldHVybiBmcm9udG1hdHRlcjtcbn1cblxuLy8gV2hlcmUgYSBmcm9udG1hdHRlciBibG9jayBsaXZlcyBpbiB0aGUgc2V0dGluZ3M6IGEgVFlQJ3MgVFlQLUZyb250bWF0dGVyXG4vLyAodHlwRGVmYXVsdEZyb250bWF0dGVyL3R5cEZsb2F0aW5nS2V5cy90eXBTaG9ydGN1dHMpIG9yIG9uZSBvZiBpdHMgU3VidHlwXG4vLyBibG9ja3MgKHR5cFN1YnR5cHMsIHNlZSBzdWJ0eXBzLmpzKS4gRWRpdG9yLCBmbG9hdGluZyBtZW51LCBzaG9ydGN1dCBidXR0b25cbi8vIGFuZCBwcm9wZXJ0eSByZW5hbWUgb25seSB1c2UgdGhpcyBpbnRlcmZhY2UgYW5kIG5lZWRuJ3Qga25vdyB3aGljaC5cbi8vXG4vLyBnZXRTaG9ydGN1dHMvc2V0U2hvcnRjdXRzIGhvbGQgdGhlIHNob3J0Y3V0IHJlY29yZHMgcGVyIGtleSAoc2VlXG4vLyBzaG9ydGN1dHMuanMpIC0gbmV4dCB0byB0aGUgZnJvbnRtYXR0ZXIsIG5vdCBpbiBpdCwgc28gdGhlIHZhbHVlIHN0YXlzXG4vLyB0eXBlLWNsZWFuLiBXaXRoIGEgc2hvcnRjdXQgc2V0LCB0aGUgdmFsdWUgcmVtYWlucyBhcyBmYWxsYmFjay5cbmZ1bmN0aW9uIHR5cFN0b3JlKHBsdWdpbiwgdHlwKSB7XG4gIHJldHVybiB7XG4gICAgdHlwLFxuICAgIHN1YnR5cDogbnVsbCxcbiAgICBnZXRGcm9udG1hdHRlcjogKCkgPT4gcGx1Z2luLnNldHRpbmdzLnR5cERlZmF1bHRGcm9udG1hdHRlclt0eXBdID8/IHt9LFxuICAgIHNldEZyb250bWF0dGVyOiAoZnJvbnRtYXR0ZXIpID0+IHtcbiAgICAgIHBsdWdpbi5zZXR0aW5ncy50eXBEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwXSA9IGZyb250bWF0dGVyO1xuICAgIH0sXG4gICAgZ2V0RmxvYXRpbmc6ICgpID0+IHBsdWdpbi5zZXR0aW5ncy50eXBGbG9hdGluZ0tleXNbdHlwXSA/PyBbXSxcbiAgICBzZXRGbG9hdGluZzogKGtleXMpID0+IHtcbiAgICAgIGlmIChrZXlzLmxlbmd0aCA+IDApIHBsdWdpbi5zZXR0aW5ncy50eXBGbG9hdGluZ0tleXNbdHlwXSA9IGtleXM7XG4gICAgICBlbHNlIGRlbGV0ZSBwbHVnaW4uc2V0dGluZ3MudHlwRmxvYXRpbmdLZXlzW3R5cF07XG4gICAgfSxcbiAgICBnZXRTaG9ydGN1dHM6ICgpID0+IHBsdWdpbi5zZXR0aW5ncy50eXBTaG9ydGN1dHNbdHlwXSA/PyB7fSxcbiAgICBzZXRTaG9ydGN1dHM6IChzaG9ydGN1dHMpID0+IHtcbiAgICAgIGlmIChPYmplY3Qua2V5cyhzaG9ydGN1dHMpLmxlbmd0aCA+IDApIHBsdWdpbi5zZXR0aW5ncy50eXBTaG9ydGN1dHNbdHlwXSA9IHNob3J0Y3V0cztcbiAgICAgIGVsc2UgZGVsZXRlIHBsdWdpbi5zZXR0aW5ncy50eXBTaG9ydGN1dHNbdHlwXTtcbiAgICB9LFxuICB9O1xufVxuXG5mdW5jdGlvbiBzdWJ0eXBTdG9yZShwbHVnaW4sIHR5cCwgc3VidHlwKSB7XG4gIHJldHVybiB7XG4gICAgdHlwLFxuICAgIHN1YnR5cCxcbiAgICBnZXRGcm9udG1hdHRlcjogKCkgPT4gZ2V0U3VidHlwKHBsdWdpbi5zZXR0aW5ncywgdHlwLCBzdWJ0eXApPy5mcm9udG1hdHRlciA/PyB7fSxcbiAgICBzZXRGcm9udG1hdHRlcjogKGZyb250bWF0dGVyKSA9PiB7XG4gICAgICBlbnN1cmVTdWJ0eXAocGx1Z2luLnNldHRpbmdzLCB0eXAsIHN1YnR5cCkuZnJvbnRtYXR0ZXIgPSBmcm9udG1hdHRlcjtcbiAgICB9LFxuICAgIGdldEZsb2F0aW5nOiAoKSA9PiBnZXRTdWJ0eXAocGx1Z2luLnNldHRpbmdzLCB0eXAsIHN1YnR5cCk/LmZsb2F0aW5nS2V5cyA/PyBbXSxcbiAgICBzZXRGbG9hdGluZzogKGtleXMpID0+IHtcbiAgICAgIGVuc3VyZVN1YnR5cChwbHVnaW4uc2V0dGluZ3MsIHR5cCwgc3VidHlwKS5mbG9hdGluZ0tleXMgPSBrZXlzO1xuICAgIH0sXG4gICAgZ2V0U2hvcnRjdXRzOiAoKSA9PiBnZXRTdWJ0eXAocGx1Z2luLnNldHRpbmdzLCB0eXAsIHN1YnR5cCk/LnNob3J0Y3V0cyA/PyB7fSxcbiAgICBzZXRTaG9ydGN1dHM6IChzaG9ydGN1dHMpID0+IHtcbiAgICAgIGVuc3VyZVN1YnR5cChwbHVnaW4uc2V0dGluZ3MsIHR5cCwgc3VidHlwKS5zaG9ydGN1dHMgPSBzaG9ydGN1dHM7XG4gICAgfSxcbiAgfTtcbn1cblxuLy8gT2JzaWRpYW4ncyBwcm9wZXJ0aWVzIHdpZGdldCBpcyBubyBvZmZpY2lhbCBBUEkuIEludGVybmFsbHkgaXQgaXMgYVxuLy8gY29tcG9uZW50IGNsYXNzIChtaW5pZmllZCBcIk1ldGFkYXRhRWRpdG9yXCIpIHRoYXQgZXZlcnkgTWFya2Rvd25WaWV3IGFuZCB0aGVcbi8vIGZpbGUgcHJvcGVydGllcyBwYW5lIGluc3RhbnRpYXRlIGFzIHZpZXcubWV0YWRhdGFFZGl0b3IuIEl0IGlzbid0IGV4cG9ydGVkLFxuLy8gYnV0IGFueSBpbnN0YW5jZSByZWFjaGVzIGl0IHZpYSAuY29uc3RydWN0b3IsIGFuZCBpdCBpcyBzdGFibGUgZm9yIHRoZVxuLy8gc2Vzc2lvbiAtIGdyYWJiaW5nIGl0IG9uY2UgaXMgZW5vdWdoLlxubGV0IGNhY2hlZEVkaXRvckNsYXNzID0gbnVsbDtcblxuZnVuY3Rpb24gZ2V0TWV0YWRhdGFFZGl0b3JDbGFzcyhhcHApIHtcbiAgaWYgKGNhY2hlZEVkaXRvckNsYXNzKSByZXR1cm4gY2FjaGVkRWRpdG9yQ2xhc3M7XG5cbiAgY29uc3QgYWN0aXZlID0gYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVWaWV3T2ZUeXBlKE1hcmtkb3duVmlldyk7XG4gIGlmIChhY3RpdmU/Lm1ldGFkYXRhRWRpdG9yKSB7XG4gICAgY2FjaGVkRWRpdG9yQ2xhc3MgPSBhY3RpdmUubWV0YWRhdGFFZGl0b3IuY29uc3RydWN0b3I7XG4gICAgcmV0dXJuIGNhY2hlZEVkaXRvckNsYXNzO1xuICB9XG4gIGZvciAoY29uc3QgbGVhZiBvZiBhcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcIm1hcmtkb3duXCIpKSB7XG4gICAgaWYgKGxlYWYudmlldz8ubWV0YWRhdGFFZGl0b3IpIHtcbiAgICAgIGNhY2hlZEVkaXRvckNsYXNzID0gbGVhZi52aWV3Lm1ldGFkYXRhRWRpdG9yLmNvbnN0cnVjdG9yO1xuICAgICAgcmV0dXJuIGNhY2hlZEVkaXRvckNsYXNzO1xuICAgIH1cbiAgfVxuICBjYWNoZWRFZGl0b3JDbGFzcyA9IGhhcnZlc3RFZGl0b3JDbGFzcyhhcHApO1xuICByZXR1cm4gY2FjaGVkRWRpdG9yQ2xhc3M7XG59XG5cbi8vIEJlZm9yZSBhbnkgbm90ZSB3YXMgb3BlbiB0aGlzIHNlc3Npb24gdGhlcmUgaXMgbm8gaW5zdGFuY2UgdG8gcmVhY2ggdGhlXG4vLyBjbGFzcyB0aHJvdWdoLiBUaGVuIHdlIGJ1aWxkIG9uZTogYSBmcmVlIFdvcmtzcGFjZUxlYWYgKG5vIHBhcmVudCwgbmV2ZXIgaW5cbi8vIHRoZSBET00pIHdpdGggYSBNYXJrZG93blZpZXcgZnJvbSBPYnNpZGlhbidzIHZpZXcgcmVnaXN0cnksIHdob3NlXG4vLyBjb25zdHJ1Y3RvciBjcmVhdGVzIG1ldGFkYXRhRWRpdG9yLiBPbmx5IHRoZSBjbGFzcyBpcyBuZWVkZWQ7IHRoZSB2aWV3IGlzXG4vLyB1bmxvYWRlZCByaWdodCBhd2F5LiBEZWxpYmVyYXRlbHkgTk9UIGxlYWYuZGV0YWNoKCk6IHRoYXQgZXhwZWN0cyBhIHBhcmVudFxuLy8gdGhpcyBsZWFmIG5ldmVyIGhhZC5cbmZ1bmN0aW9uIGhhcnZlc3RFZGl0b3JDbGFzcyhhcHApIHtcbiAgbGV0IHZpZXcgPSBudWxsO1xuICB0cnkge1xuICAgIGNvbnN0IGNyZWF0ZVZpZXcgPSBhcHAudmlld1JlZ2lzdHJ5Py5nZXRWaWV3Q3JlYXRvckJ5VHlwZT8uKFwibWFya2Rvd25cIik7XG4gICAgaWYgKCFjcmVhdGVWaWV3KSByZXR1cm4gbnVsbDtcbiAgICB2aWV3ID0gY3JlYXRlVmlldyhuZXcgV29ya3NwYWNlTGVhZihhcHApKTtcbiAgICByZXR1cm4gdmlldy5tZXRhZGF0YUVkaXRvcj8uY29uc3RydWN0b3IgPz8gbnVsbDtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBjb25zb2xlLmVycm9yKFwiW3R5cC1zeXN0ZW1dIGNvdWxkbid0IGZpbmQgdGhlIE1ldGFkYXRhRWRpdG9yIGNsYXNzXCIsIGVycm9yKTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfSBmaW5hbGx5IHtcbiAgICB0cnkge1xuICAgICAgdmlldz8udW5sb2FkKCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJbdHlwLXN5c3RlbV0gY291bGRuJ3QgZGlzY2FyZCB0aGUgaGVscGVyIE1hcmtkb3duVmlld1wiLCBlcnJvcik7XG4gICAgfVxuICB9XG59XG5cbi8vIExpa2UgZ2V0TWV0YWRhdGFFZGl0b3JDbGFzczogdGhlIHByaXZhdGUgcHJvcGVydHkgcm93IGNsYXNzLCB0YWtlbiBmcm9tIGFuXG4vLyBhbHJlYWR5IHJlbmRlcmVkIHJvdy4gT25seSBlbnN1cmVQcm9wZXJ0eU1lbnVQYXRjaCgpIG5lZWRzIGl0LCBhbmQgYGVkaXRvcmBcbi8vIHVzdWFsbHkgaGFzIGEgcm93IGJ5IHRoZW4sIHNvIGl0IGlzIHRyaWVkIGZpcnN0LlxubGV0IGNhY2hlZFByb3BlcnR5Um93Q2xhc3MgPSBudWxsO1xuXG5mdW5jdGlvbiBnZXRQcm9wZXJ0eVJvd0NsYXNzKGFwcCwgZWRpdG9yKSB7XG4gIGlmIChjYWNoZWRQcm9wZXJ0eVJvd0NsYXNzKSByZXR1cm4gY2FjaGVkUHJvcGVydHlSb3dDbGFzcztcbiAgaWYgKGVkaXRvcj8ucmVuZGVyZWQ/LlswXSkge1xuICAgIGNhY2hlZFByb3BlcnR5Um93Q2xhc3MgPSBlZGl0b3IucmVuZGVyZWRbMF0uY29uc3RydWN0b3I7XG4gICAgcmV0dXJuIGNhY2hlZFByb3BlcnR5Um93Q2xhc3M7XG4gIH1cbiAgY29uc3QgYWN0aXZlID0gYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVWaWV3T2ZUeXBlKE1hcmtkb3duVmlldyk7XG4gIGlmIChhY3RpdmU/Lm1ldGFkYXRhRWRpdG9yPy5yZW5kZXJlZD8uWzBdKSB7XG4gICAgY2FjaGVkUHJvcGVydHlSb3dDbGFzcyA9IGFjdGl2ZS5tZXRhZGF0YUVkaXRvci5yZW5kZXJlZFswXS5jb25zdHJ1Y3RvcjtcbiAgICByZXR1cm4gY2FjaGVkUHJvcGVydHlSb3dDbGFzcztcbiAgfVxuICBmb3IgKGNvbnN0IGxlYWYgb2YgYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoXCJtYXJrZG93blwiKSkge1xuICAgIGlmIChsZWFmLnZpZXc/Lm1ldGFkYXRhRWRpdG9yPy5yZW5kZXJlZD8uWzBdKSB7XG4gICAgICBjYWNoZWRQcm9wZXJ0eVJvd0NsYXNzID0gbGVhZi52aWV3Lm1ldGFkYXRhRWRpdG9yLnJlbmRlcmVkWzBdLmNvbnN0cnVjdG9yO1xuICAgICAgcmV0dXJuIGNhY2hlZFByb3BlcnR5Um93Q2xhc3M7XG4gICAgfVxuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vLyBBZGRzIGEgXCJGbG9hdGluZ1wiIHRvZ2dsZSBhdCB0aGUgdmVyeSB0b3Agb2YgYSBwcm9wZXJ0eSByb3cncyBjb250ZXh0IG1lbnUgLVxuLy8gb25seSBmb3Igcm93cyBvZiB0aGUgcGx1Z2luJ3Mgb3duIFRZUC1QYW5lIChyZWNvZ25pemVkIGJ5IG93bmVyLnR5cFN0b3JlKSxcbi8vIG5ldmVyIGluIHJlYWwgbm90ZXMuIFVubGlrZSB0aGUgZXh0cmEgXCIrXCIgYnV0dG9uICh0eXBQZW5kaW5nRmxvYXRpbmdBZGQpLFxuLy8gd2hpY2ggb25seSBhZmZlY3RzIGEgTkVXIHByb3BlcnR5LCB0aGlzIHdvcmtzIG9uIGFueSBleGlzdGluZyBvbmUsIGJvdGggd2F5cy5cbi8vXG4vLyBUaGUgcHJvcGVydHkgbWVudSBpcyBubyBvZmZpY2lhbCBleHRlbnNpb24gcG9pbnQ6IG9uIGRlc2t0b3AgaXQgYnVpbGRzIGFcbi8vIE5BVElWRSBFbGVjdHJvbiBtZW51IGZyb20gYW4gaW50ZXJuYWwgTWVudSBhbmQgc2hvd3MgaXQgd2l0aGluXG4vLyBzaG93UHJvcGVydHlNZW51KCkgaW4gb25lIHN5bmNocm9ub3VzIGNhbGwgLSBubyB3b3Jrc3BhY2UgZXZlbnQsIG5vIERPTVxuLy8gcG9wdXAgdG8gYW1lbmQgYWZ0ZXJ3YXJkcy4gU28gdGhlIHByaXZhdGUgcm93IGNsYXNzIGlzIHBhdGNoZWQsIGFzIG5hcnJvd2x5XG4vLyBhcyBwb3NzaWJsZTogZm9yIG91ciByb3dzLCByaWdodCBiZWZvcmUgT2JzaWRpYW4gc2hvd3MgaXRzIGZpbmlzaGVkIG1lbnUsXG4vLyBvbmUgYWRkSXRlbSgpIGlzIHNsaXBwZWQgaW4gdGhyb3VnaCBhIHBhdGNoIG9uIE1lbnUucHJvdG90eXBlLnNob3dBdE1vdXNlRXZlbnRcbi8vIHRoYXQgcmVzZXRzIGl0c2VsZiBhZnRlciB0aGlzIG9uZSBjYWxsIChzYWZlLCBKUyBpcyBzaW5nbGUtdGhyZWFkZWQpLiBUaGVcbi8vIHJlc3Qgb2YgdGhlIG5hdGl2ZSBtZW51IHN0YXlzIHVudG91Y2hlZC5cbmxldCB1bmRvUHJvcGVydHlNZW51UGF0Y2ggPSBudWxsO1xuXG5mdW5jdGlvbiBlbnN1cmVQcm9wZXJ0eU1lbnVQYXRjaChhcHAsIGVkaXRvcikge1xuICBjb25zdCBSb3dDbGFzcyA9IGdldFByb3BlcnR5Um93Q2xhc3MoYXBwLCBlZGl0b3IpO1xuICBpZiAoIVJvd0NsYXNzIHx8IFJvd0NsYXNzLl90eXBTeXN0ZW1NZW51UGF0Y2hlZCkgcmV0dXJuO1xuICBSb3dDbGFzcy5fdHlwU3lzdGVtTWVudVBhdGNoZWQgPSB0cnVlO1xuXG4gIGNvbnN0IG9yaWdpbmFsU2hvd1Byb3BlcnR5TWVudSA9IFJvd0NsYXNzLnByb3RvdHlwZS5zaG93UHJvcGVydHlNZW51O1xuICB1bmRvUHJvcGVydHlNZW51UGF0Y2ggPSAoKSA9PiB7XG4gICAgUm93Q2xhc3MucHJvdG90eXBlLnNob3dQcm9wZXJ0eU1lbnUgPSBvcmlnaW5hbFNob3dQcm9wZXJ0eU1lbnU7XG4gICAgZGVsZXRlIFJvd0NsYXNzLl90eXBTeXN0ZW1NZW51UGF0Y2hlZDtcbiAgfTtcbiAgUm93Q2xhc3MucHJvdG90eXBlLnNob3dQcm9wZXJ0eU1lbnUgPSBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICBjb25zdCBvd25lciA9IHRoaXMubWV0YWRhdGFFZGl0b3I/Lm93bmVyO1xuICAgIGlmICghb3duZXI/LnR5cFN0b3JlKSByZXR1cm4gb3JpZ2luYWxTaG93UHJvcGVydHlNZW51LmNhbGwodGhpcywgZXZlbnQpO1xuXG4gICAgY29uc3Qgcm93ID0gdGhpcztcbiAgICBjb25zdCBvcmlnaW5hbFNob3dBdE1vdXNlRXZlbnQgPSBNZW51LnByb3RvdHlwZS5zaG93QXRNb3VzZUV2ZW50O1xuICAgIE1lbnUucHJvdG90eXBlLnNob3dBdE1vdXNlRXZlbnQgPSBmdW5jdGlvbiAobW91c2VFdmVudCkge1xuICAgICAgTWVudS5wcm90b3R5cGUuc2hvd0F0TW91c2VFdmVudCA9IG9yaWdpbmFsU2hvd0F0TW91c2VFdmVudDtcbiAgICAgIGNvbnN0IGlzRmxvYXRpbmcgPSBvd25lci50eXBTdG9yZS5nZXRGbG9hdGluZygpLmluY2x1ZGVzKHJvdy5lbnRyeS5rZXkpO1xuICAgICAgLy8gXCJ0aXRsZVwiIGlzIHRoZSBmaXJzdCBzZWN0aW9uIHNob3dQcm9wZXJ0eU1lbnUgcmVnaXN0ZXJzIGFuZCBpcyBlbXB0eVxuICAgICAgLy8gb24gZGVza3RvcCwgc28gdGhpcyBsYW5kcyByZWxpYWJseSBvbiB0b3AuIFwicGluLW9mZlwiID0gbm90IHBpbm5lZCA9XG4gICAgICAvLyBmbG9hdGluZy5cbiAgICAgIHRoaXMuYWRkSXRlbSgoaXRlbSkgPT5cbiAgICAgICAgaXRlbVxuICAgICAgICAgIC5zZXRUaXRsZShcIkZsb2F0aW5nXCIpXG4gICAgICAgICAgLnNldEljb24oXCJwaW4tb2ZmXCIpXG4gICAgICAgICAgLnNldENoZWNrZWQoaXNGbG9hdGluZylcbiAgICAgICAgICAuc2V0U2VjdGlvbihcInRpdGxlXCIpXG4gICAgICAgICAgLm9uQ2xpY2soKCkgPT4gdG9nZ2xlRmxvYXRpbmdQcm9wZXJ0eShvd25lci50eXBQYW5lLCBvd25lci50eXBTdG9yZSwgcm93LmVudHJ5LmtleSkpXG4gICAgICApO1xuICAgICAgcmV0dXJuIG9yaWdpbmFsU2hvd0F0TW91c2VFdmVudC5jYWxsKHRoaXMsIG1vdXNlRXZlbnQpO1xuICAgIH07XG5cbiAgICByZXR1cm4gb3JpZ2luYWxTaG93UHJvcGVydHlNZW51LmNhbGwodGhpcywgZXZlbnQpO1xuICB9O1xufVxuXG4vLyBPbiB1bmxvYWQ7IG90aGVyd2lzZSB0aGUgcGF0Y2ggd291bGQgb3V0bGl2ZSBhIGhvdCByZWxvYWQgd2l0aCB0aGUgb2xkXG4vLyBtb2R1bGUncyBjbG9zdXJlcy5cbmZ1bmN0aW9uIHJlbW92ZVByb3BlcnR5TWVudVBhdGNoKCkge1xuICB1bmRvUHJvcGVydHlNZW51UGF0Y2g/LigpO1xuICB1bmRvUHJvcGVydHlNZW51UGF0Y2ggPSBudWxsO1xufVxuXG5mdW5jdGlvbiB0b2dnbGVGbG9hdGluZ1Byb3BlcnR5KHZpZXcsIHN0b3JlLCBrZXkpIHtcbiAgY29uc3QgZmxvYXRpbmcgPSBzdG9yZS5nZXRGbG9hdGluZygpO1xuICBzdG9yZS5zZXRGbG9hdGluZyhmbG9hdGluZy5pbmNsdWRlcyhrZXkpID8gZmxvYXRpbmcuZmlsdGVyKChrKSA9PiBrICE9PSBrZXkpIDogWy4uLmZsb2F0aW5nLCBrZXldKTtcbiAgdmlldy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gIC8vIFVwZGF0ZXMgdGhlIGJvbGQvaXRhbGljIG1hcmtzIGF0IG9uY2UsIGhlcmUgKHJlZnJlc2hGcm9udG1hdHRlckhpZ2hsaWdodFxuICAvLyBjb3ZlcnMgdGhlIFRZUC1QYW5lJ3Mgb3duIGVkaXRvcnMpIGFuZCBpbiBvcGVuIG5vdGVzIC0gd2l0aG91dFxuICAvLyByZS1yZW5kZXJpbmcgdGhpcyBUWVAtUGFuZSwgc2VlIHJlZnJlc2hUeXBDb2xvcnNFeGNlcHQgaW4gbWFpbi5qcy5cbiAgdmlldy5wbHVnaW4ucmVmcmVzaFR5cENvbG9yc0V4Y2VwdD8uKHZpZXcpO1xufVxuXG4vLyBLZXlib2FyZCBuYXZpZ2F0aW9uIGJleW9uZCBvbmUgZWRpdG9yIGluc3RhbmNlIChzZWUgZnJvbnRtYXR0ZXItYmxvY2tzLmpzKTpcbi8vIE9ic2lkaWFuIG1vdmVzIGZvY3VzIG9ubHkgd2l0aGluIGl0cyBvd24gcm93IGxpc3QsIGFuZCBhdCBlaXRoZXIgZW5kIG9udG9cbi8vIHRoZSBlZGl0b3IncyBoZWFkaW5nIG9yIFwiQWRkIHByb3BlcnR5XCIgYnV0dG9uIC0gYm90aCBoaWRkZW4gaGVyZSBieSBDU1MsIHNvXG4vLyB0aGUgY2hhaW4gc3RvcHBlZCBhdCB0aGUgYmxvY2sgZWRnZS5cbi8vXG4vLyBvd25lci5zaGlmdEZvY3VzQmVmb3JlL0FmdGVyIGFyZSBvbmx5IHJlYWNoZWQgdGhyb3VnaCBleGFjdGx5IHRob3NlIGhpZGRlblxuLy8gZWxlbWVudHMsIHNvIGluc3RlYWQgYSBjYXB0dXJlLXBoYXNlIGhhbmRsZXIgcnVucyBCRUZPUkUgdGhlIHJvdydzIG93bi4gSXRcbi8vIG9ubHkgYWN0cyB3aGlsZSB0aGUgcm93IElUU0VMRiBoYXMgZm9jdXMgKGV2ZW50LnRhcmdldCBpcyB0aGUgcm93J3Ncbi8vIGNvbnRhaW5lcikgLSB0aGUgc2FtZSBjb25kaXRpb24gdW5kZXIgd2hpY2ggT2JzaWRpYW4gYWxsb3dzIGovaywgc28gbmV2ZXJcbi8vIHdoaWxlIHR5cGluZyBpbiBhIGZpZWxkLlxuZnVuY3Rpb24gcmVnaXN0ZXJGb2N1c0NoYWluKGVkaXRvciwgb25TaGlmdEZvY3VzKSB7XG4gIGVkaXRvci5jb250YWluZXJFbC5hZGRFdmVudExpc3RlbmVyKFxuICAgIFwia2V5ZG93blwiLFxuICAgIChldmVudCkgPT4ge1xuICAgICAgaWYgKGV2ZW50LmlzQ29tcG9zaW5nIHx8IGV2ZW50LmRlZmF1bHRQcmV2ZW50ZWQpIHJldHVybjtcbiAgICAgIC8vIE11bHRpLXNlbGVjdGlvbjogT2JzaWRpYW4gZXh0ZW5kcyB0aGUgc2VsZWN0aW9uIGluc3RlYWQgb2YgbW92aW5nLlxuICAgICAgaWYgKGVkaXRvci5zZWxlY3RlZExpbmVzPy5zaXplID4gMSkgcmV0dXJuO1xuICAgICAgaWYgKGV2ZW50LnNoaWZ0S2V5ICYmIChldmVudC5rZXkgPT09IFwiQXJyb3dVcFwiIHx8IGV2ZW50LmtleSA9PT0gXCJBcnJvd0Rvd25cIikpIHJldHVybjtcblxuICAgICAgY29uc3QgaW5kZXggPSBlZGl0b3IucmVuZGVyZWQuZmluZEluZGV4KChyb3cpID0+IHJvdy5jb250YWluZXJFbCA9PT0gZXZlbnQudGFyZ2V0KTtcbiAgICAgIGlmIChpbmRleCA9PT0gLTEpIHJldHVybjtcblxuICAgICAgY29uc3QgdXAgPSBldmVudC5rZXkgPT09IFwiQXJyb3dVcFwiIHx8IGV2ZW50LmtleSA9PT0gXCJrXCIgfHwgKGV2ZW50LmtleSA9PT0gXCJUYWJcIiAmJiBldmVudC5zaGlmdEtleSk7XG4gICAgICBjb25zdCBkb3duID0gZXZlbnQua2V5ID09PSBcIkFycm93RG93blwiIHx8IGV2ZW50LmtleSA9PT0gXCJqXCIgfHwgKGV2ZW50LmtleSA9PT0gXCJUYWJcIiAmJiAhZXZlbnQuc2hpZnRLZXkpO1xuICAgICAgbGV0IHN0ZXAgPSAwO1xuICAgICAgaWYgKHVwICYmIGluZGV4ID09PSAwKSBzdGVwID0gLTE7XG4gICAgICBlbHNlIGlmIChkb3duICYmIGluZGV4ID09PSBlZGl0b3IucmVuZGVyZWQubGVuZ3RoIC0gMSkgc3RlcCA9IDE7XG4gICAgICBpZiAoc3RlcCA9PT0gMCB8fCAhb25TaGlmdEZvY3VzKHN0ZXApKSByZXR1cm47XG5cbiAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICB9LFxuICAgIHRydWVcbiAgKTtcbn1cblxuLy8gVGhlIHdpZGdldCB0YWtlcyBhbiBcIm93bmVyXCIgYXMgc2Vjb25kIGNvbnN0cnVjdG9yIGFyZ3VtZW50IC0gdGhlIG9ubHkgdGhpbmdcbi8vIGJpbmRpbmcgaXQgdG8gYSBmaWxlLiBIZXJlIGl0IGlzIGJvdW5kIHRvIGEgcGxhaW4gb2JqZWN0IGluIHRoZSBzZXR0aW5nczpcbi8vIHNhdmVGcm9udG1hdHRlcihvYmopIGdldHMgdGhlIGZ1bGwgcHJvcGVydHkgc2V0IG9uIGV2ZXJ5IGNoYW5nZS5cbi8vIHNoaWZ0Rm9jdXNCZWZvcmUvQWZ0ZXIgbWF5IGJlIG5vLW9wcy4gZ2V0RmlsZSgpIGlzIGNhbGxlZCBieSBldmVyeSByb3cgd2hpbGVcbi8vIHJlbmRlcmluZyAoZm9yIHNvdXJjZVBhdGgpOyB0aGVyZSBpcyBubyByZWFsIGZpbGUsIGJ1dCB0aGUgbWV0aG9kIG11c3QgZXhpc3Rcbi8vIG9yIHRoZSB3aWRnZXQgY3Jhc2hlcy5cbi8vXG4vLyBPbmUgZWRpdG9yIHBlciBibG9jayAoVFlQIG9yIFN1YnR5cCksIGJvdW5kIHRvIGBzdG9yZWAuIFN0YW5kYXJkIGFuZFxuLy8gZmxvYXRpbmcgcHJvcGVydGllcyBzaGFyZSBvbmUgbGlzdCBhbmQgb3JkZXI7IGdldFR5cERlZmF1bHRzKCkganVzdCBsZWF2ZXNcbi8vIHRoZSBmbG9hdGluZyBvbmVzIG91dC4gZWRpdG9yLnR5cFBlbmRpbmdGbG9hdGluZ0FkZCwgc2V0IGJlZm9yZVxuLy8gYWRkQmxhbmtQcm9wZXJ0eSgpLCBtYXJrcyB0aGUgbmV4dCBhZGRlZCAob3IgcmVuYW1lZCkgcHJvcGVydHkgYXMgZmxvYXRpbmcgLVxuLy8gc2VlIHNhdmVGcm9udG1hdHRlci5cbmZ1bmN0aW9uIG1vdW50RnJvbnRtYXR0ZXJFZGl0b3IodmlldywgY29udGFpbmVyRWwsIHN0b3JlLCB7IG9uU2hpZnRGb2N1cyB9ID0ge30pIHtcbiAgY29uc3QgYXBwID0gdmlldy5hcHA7XG4gIGNvbnN0IEVkaXRvckNsYXNzID0gZ2V0TWV0YWRhdGFFZGl0b3JDbGFzcyhhcHApO1xuICBpZiAoIUVkaXRvckNsYXNzKSB7XG4gICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJwXCIsIHtcbiAgICAgIGNsczogXCJ0eXAtZnJvbnRtYXR0ZXItdW5hdmFpbGFibGVcIixcbiAgICAgIHRleHQ6IFwiT3BlbiBhIG5vdGUgb25jZSB0byBpbml0aWFsaXplIHRoZSBlZGl0b3IuXCIsXG4gICAgfSk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBjb25zdCBvd25lciA9IHtcbiAgICBhcHAsXG4gICAgLy8gTGV0cyBlbnN1cmVQcm9wZXJ0eU1lbnVQYXRjaCgpIHJlY29nbml6ZSByb3dzIG9mIHRoaXMgZWRpdG9yIGFuZCBnaXZlc1xuICAgIC8vIHRoZSBnbG9iYWwgbWVudSBwYXRjaCB0aGUgc3RvcmUgYW5kIHZpZXcgcGVyIHJvdyAodGhlIHBhdGNoIGl0c2VsZiBpc1xuICAgIC8vIGluc3RhbGxlZCBvbmx5IG9uY2UpLlxuICAgIHR5cFN0b3JlOiBzdG9yZSxcbiAgICB0eXBQYW5lOiB2aWV3LFxuICAgIGdldEZpbGUoKSB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9LFxuICAgIC8vIE9ubHkgZm9yIE9ic2lkaWFuJ3MgaG92ZXIgcHJldmlldyBvZiBpbnRlcm5hbCBsaW5rcyBpbiBhIHZhbHVlOyBhbnlcbiAgICAvLyBzdHJpbmcgd2lsbCBkby5cbiAgICBnZXRIb3ZlclNvdXJjZSgpIHtcbiAgICAgIHJldHVybiBcInR5cC1mcm9udG1hdHRlclwiO1xuICAgIH0sXG4gICAgc2hpZnRGb2N1c0JlZm9yZSgpIHt9LFxuICAgIHNoaWZ0Rm9jdXNBZnRlcigpIHt9LFxuICAgIC8vIENhbGxlZCBvbmNlIHBlciBjb21wbGV0ZWQgY2hhbmdlIChhIHJlbmFtZSBvbmx5IG9uIGJsdXIgb2YgdGhlIGtleVxuICAgIC8vIGlucHV0KSwgc28gZWFjaCBjYWxsIGFkZHMgYW5kL29yIHJlbW92ZXMgYXQgbW9zdCBvbmUgbm9uLWVtcHR5IHByb3BlcnR5LFxuICAgIC8vIGV4Y2VwdCBhIG11bHRpLWRlbGV0ZS4gVGhhdCBrZWVwcyB0aGUgZmxvYXRpbmcgZmxhZyBlYXN5IHRvIHRyYWNrXG4gICAgLy8gd2l0aG91dCBmb2xsb3dpbmcgaW50ZXJtZWRpYXRlIHR5cGluZyBzdGF0ZXMuXG4gICAgc2F2ZUZyb250bWF0dGVyKGZyb250bWF0dGVyKSB7XG4gICAgICAvLyBBIHJvdyBqdXN0IG5hbWVkIFwiVFlQXCIvXCJTVUJUWVBcIiBpc24ndCBzYXZlZC4gSXQgc3RheXMgdmlzaWJsZSB1bnRpbFxuICAgICAgLy8gdGhlIG5leHQgbW91bnQgKG5vIHN5bmNocm9uaXplKCkgaGVyZSwgc2VlIHN0cmlwVHlwUHJvcGVydHkpLlxuICAgICAgc3RyaXBUeXBQcm9wZXJ0eShmcm9udG1hdHRlcik7XG5cbiAgICAgIGNvbnN0IHByZXZpb3VzID0gc3RvcmUuZ2V0RnJvbnRtYXR0ZXIoKTtcbiAgICAgIGNvbnN0IHByZXZpb3VzS2V5cyA9IE9iamVjdC5rZXlzKHByZXZpb3VzKS5maWx0ZXIoKGtleSkgPT4ga2V5ICE9PSBcIlwiKTtcbiAgICAgIGNvbnN0IGN1cnJlbnRLZXlzID0gT2JqZWN0LmtleXMoZnJvbnRtYXR0ZXIpLmZpbHRlcigoa2V5KSA9PiBrZXkgIT09IFwiXCIpO1xuICAgICAgY29uc3QgcmVtb3ZlZEtleXMgPSBwcmV2aW91c0tleXMuZmlsdGVyKChrZXkpID0+ICFjdXJyZW50S2V5cy5pbmNsdWRlcyhrZXkpKTtcbiAgICAgIGNvbnN0IGFkZGVkS2V5cyA9IGN1cnJlbnRLZXlzLmZpbHRlcigoa2V5KSA9PiAhcHJldmlvdXNLZXlzLmluY2x1ZGVzKGtleSkpO1xuICAgICAgLy8gRGVsZXRpbmcgcm93cyBsb3NlcyB2YWx1ZSwgc2hvcnRjdXQgYW5kIGZsb2F0aW5nIGZsYWcgYXQgb25jZSAtIHRoZVxuICAgICAgLy8gb25lIGNoYW5nZSBoZXJlIHRoYXQgZ2V0cyBhbiB1bmRvIChzZWUgdW5kby5qcykuIFNuYXBzaG90IGJlZm9yZSBhbnlcbiAgICAgIC8vIHN0b3JlIHdyaXRlLCBhbmQgb25seSBmb3IgYSBkZWxldGlvbiAtIG5vIGZ1bGwgY29weSBvbiBldmVyeSBlZGl0LlxuICAgICAgY29uc3QgcmVtb3ZlZE9ubHkgPSByZW1vdmVkS2V5cy5sZW5ndGggPiAwICYmIGFkZGVkS2V5cy5sZW5ndGggPT09IDA7XG4gICAgICBjb25zdCB1bmRvU25hcHNob3QgPSByZW1vdmVkT25seSA/IHNuYXBzaG90U2V0dGluZ3Modmlldy5wbHVnaW4pIDogbnVsbDtcblxuICAgICAgbGV0IGZsb2F0aW5nID0gc3RvcmUuZ2V0RmxvYXRpbmcoKTtcbiAgICAgIGlmIChyZW1vdmVkS2V5cy5sZW5ndGggPT09IDEgJiYgYWRkZWRLZXlzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICAvLyBBIHJlbmFtZTogdGhlIGZsb2F0aW5nIGZsYWcgbW92ZXMgYWxvbmcuXG4gICAgICAgIGZsb2F0aW5nID0gZmxvYXRpbmcubWFwKChrZXkpID0+IChrZXkgPT09IHJlbW92ZWRLZXlzWzBdID8gYWRkZWRLZXlzWzBdIDoga2V5KSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAocmVtb3ZlZEtleXMubGVuZ3RoID4gMCkgZmxvYXRpbmcgPSBmbG9hdGluZy5maWx0ZXIoKGtleSkgPT4gIXJlbW92ZWRLZXlzLmluY2x1ZGVzKGtleSkpO1xuICAgICAgICBpZiAoZWRpdG9yLnR5cFBlbmRpbmdGbG9hdGluZ0FkZCAmJiBhZGRlZEtleXMubGVuZ3RoID09PSAxKSB7XG4gICAgICAgICAgZmxvYXRpbmcgPSBbLi4uZmxvYXRpbmcsIGFkZGVkS2V5c1swXV07XG4gICAgICAgICAgZWRpdG9yLnR5cFBlbmRpbmdGbG9hdGluZ0FkZCA9IGZhbHNlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICAvLyBTaG9ydGN1dHMgYmVsb25nIHRvIHRoZSBrZXkgdG9vOiB0aGV5IG1vdmUgb24gcmVuYW1lIGFuZCBnbyBvbiBkZWxldGUuXG4gICAgICBjb25zdCBzaG9ydGN1dHMgPSB7IC4uLnN0b3JlLmdldFNob3J0Y3V0cygpIH07XG4gICAgICBpZiAocmVtb3ZlZEtleXMubGVuZ3RoID09PSAxICYmIGFkZGVkS2V5cy5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgaWYgKHNob3J0Y3V0c1tyZW1vdmVkS2V5c1swXV0pIHtcbiAgICAgICAgICBzaG9ydGN1dHNbYWRkZWRLZXlzWzBdXSA9IHNob3J0Y3V0c1tyZW1vdmVkS2V5c1swXV07XG4gICAgICAgICAgZGVsZXRlIHNob3J0Y3V0c1tyZW1vdmVkS2V5c1swXV07XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGZvciAoY29uc3Qga2V5IG9mIHJlbW92ZWRLZXlzKSBkZWxldGUgc2hvcnRjdXRzW2tleV07XG4gICAgICB9XG5cbiAgICAgIHN0b3JlLnNldEZyb250bWF0dGVyKGZyb250bWF0dGVyKTtcbiAgICAgIHN0b3JlLnNldEZsb2F0aW5nKGZsb2F0aW5nKTtcbiAgICAgIHN0b3JlLnNldFNob3J0Y3V0cyhzaG9ydGN1dHMpO1xuICAgICAgdmlldy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICBpZiAodW5kb1NuYXBzaG90KSB7XG4gICAgICAgIGNvbnN0IGJsb2NrTmFtZSA9IHN0b3JlLnN1YnR5cCA/PyBzdG9yZS50eXA7XG4gICAgICAgIG9mZmVyVW5kbyhcbiAgICAgICAgICB2aWV3LnBsdWdpbixcbiAgICAgICAgICByZW1vdmVkS2V5cy5sZW5ndGggPT09IDFcbiAgICAgICAgICAgID8gYFByb3BlcnR5IFwiJHtyZW1vdmVkS2V5c1swXX1cIiByZW1vdmVkIGZyb20gJHtibG9ja05hbWV9LmBcbiAgICAgICAgICAgIDogYCR7cmVtb3ZlZEtleXMubGVuZ3RofSBwcm9wZXJ0aWVzIHJlbW92ZWQgZnJvbSAke2Jsb2NrTmFtZX0uYCxcbiAgICAgICAgICB1bmRvU25hcHNob3RcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIC8vIEEgbmV3bHkgbmFtZWQgcm93IGdldHMgaXRzIGJ1dHRvbiwgYSBkZWxldGVkIG9uZSB0YWtlcyBpdCBhbG9uZy5cbiAgICAgIHJlbmRlclNob3J0Y3V0Q29udHJvbHModmlldywgZWRpdG9yLCBzdG9yZSk7XG4gICAgICAvLyBCb2xkL2l0YWxpYyBtYXJrcyBpbiBvcGVuIG5vdGVzIGZvbGxvdyB0aGUgY2hhbmdlZCBsaXN0IGF0IG9uY2UuIE5vdFxuICAgICAgLy8gdGhlIGZ1bGwgcmVmcmVzaFR5cENvbG9ycygpOiBpdCB3b3VsZCByZS1yZW5kZXIgdGhpcyBUWVAtUGFuZSwgYW5kXG4gICAgICAvLyB0aGUgZWRpdCB0aGF0IGNhbGxlZCBzYXZlRnJvbnRtYXR0ZXIgd291bGQgbG9zZSBpdHMgZm9jdXMgKFRhYiB0byB0aGVcbiAgICAgIC8vIG5leHQgcm93IHdlbnQgbm93aGVyZSkgLSB0aGUgZWRpdG9yIGFscmVhZHkgc2hvd3MgdGhlIGNoYW5nZS5cbiAgICAgIHZpZXcucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnNFeGNlcHQ/Lih2aWV3KTtcbiAgICB9LFxuICB9O1xuXG4gIGNvbnN0IGVkaXRvciA9IG5ldyBFZGl0b3JDbGFzcyhhcHAsIG93bmVyKTtcbiAgZWRpdG9yLnR5cFBlbmRpbmdGbG9hdGluZ0FkZCA9IGZhbHNlO1xuICBpZiAob25TaGlmdEZvY3VzKSByZWdpc3RlckZvY3VzQ2hhaW4oZWRpdG9yLCBvblNoaWZ0Rm9jdXMpO1xuICBlZGl0b3IuY29udGFpbmVyRWwuYWRkQ2xhc3MoRURJVE9SX0NMQVNTKTtcbiAgY29udGFpbmVyRWwuYXBwZW5kQ2hpbGQoZWRpdG9yLmNvbnRhaW5lckVsKTtcbiAgdmlldy5hZGRDaGlsZChlZGl0b3IpO1xuXG4gIGVkaXRvci5zeW5jaHJvbml6ZShzdG9yZS5nZXRGcm9udG1hdHRlcigpKTtcbiAgcmVuZGVyU2hvcnRjdXRDb250cm9scyh2aWV3LCBlZGl0b3IsIHN0b3JlKTtcbiAgLy8gT25seSBhZnRlciB0aGUgZmlyc3Qgc3luY2hyb25pemUoKSAoc2VlIGdldFByb3BlcnR5Um93Q2xhc3MpLiBBIG5vLW9wIGZvclxuICAvLyBhIHN0aWxsIGVtcHR5IFRZUDsgdGhlIG5leHQgbm9uLWVtcHR5IG9uZSAob3IgYW4gb3BlbiBub3RlKSBzdXBwbGllcyB0aGVcbiAgLy8gY2xhc3MuXG4gIGVuc3VyZVByb3BlcnR5TWVudVBhdGNoKGFwcCwgZWRpdG9yKTtcbiAgcmV0dXJuIGVkaXRvcjtcbn1cblxuY29uc3QgQ0hJUF9DTEFTUyA9IFwidHlwLXNob3J0Y3V0LWNoaXBcIjtcbmNvbnN0IENISVBfVEVYVF9DTEFTUyA9IFwidHlwLXNob3J0Y3V0LWNoaXAtdGV4dFwiO1xuY29uc3QgQlVUVE9OX0NMQVNTID0gXCJ0eXAtc2hvcnRjdXQtYnV0dG9uXCI7XG5jb25zdCBST1dfQ0xBU1MgPSBcInR5cC1oYXMtc2hvcnRjdXRcIjtcbmNvbnN0IFdBUk5JTkdfQ0xBU1MgPSBcInR5cC1zaG9ydGN1dC1ibG9ja2VkXCI7XG5jb25zdCBNSVNTSU5HX0NMQVNTID0gXCJ0eXAtc2hvcnRjdXQtbWlzc2luZ1wiO1xuXG4vLyBUaGUgYnV0dG9uJ3MgdGhyZWUgbG9va3MuIFwibWlzc2luZ1wiOiBhIFwidHAuXCIgc2hvcnRjdXQgd2hvc2UgVGVtcGxhdGVyXG4vLyBzY3JpcHQgaXMgZ29uZSAoZGVsZXRlZCwgcmVuYW1lZCwgbWFya2VyIHJlbW92ZWQpIC0gVFlQLmpzIHdvdWxkIHdyaXRlIHRoZVxuLy8gZmFsbGJhY2sgdmFsdWUuIFNhbWUgdHJpYW5nbGUgYXMgT2JzaWRpYW4ncyB0eXBlIHdhcm5pbmcsIGFuZCBhIGNsaWNrXG4vLyByZW1vdmVzIHRoZSBzaG9ydGN1dCBsaWtlIHRoZSBcInhcIiAodGhlIGNoaXAgc3RpbGwgY2hhbmdlcyBpdCkuXG5jb25zdCBCVVRUT05fU1RBVEVTID0ge1xuICBub25lOiB7IGljb246IFwic3F1YXJlLWZ1bmN0aW9uXCIsIGxhYmVsOiBcIlNldCBzaG9ydGN1dFwiIH0sXG4gIHNldDogeyBpY29uOiBcInhcIiwgbGFiZWw6IFwiUmVtb3ZlIHNob3J0Y3V0XCIgfSxcbiAgbWlzc2luZzogeyBpY29uOiBcImFsZXJ0LXRyaWFuZ2xlXCIsIGxhYmVsOiBcIlNjcmlwdCBub3QgZm91bmQgXHUyMDEzIHRoZSBmYWxsYmFjayB2YWx1ZSB3aWxsIGJlIHVzZWQuIENsaWNrIHRvIHJlbW92ZSB0aGUgc2hvcnRjdXQuXCIgfSxcbn07XG5cbi8vIEJ1dHRvbiBhbmQgY2hpcCBwZXIgcHJvcGVydHkgcm93LiBCb3RoIGhhbmcgb24gdGhlIHJvdydzIGNvbnRhaW5lckVsLCBOT1QgaXRzXG4vLyB2YWx1ZUVsOiByZW5kZXJQcm9wZXJ0eSgpIG9ubHkgZXZlciBlbXB0aWVzIHZhbHVlRWwsIHNvIGFueXRoaW5nIGF0dGFjaGVkIHRvXG4vLyBjb250YWluZXJFbCBzdXJ2aXZlcyBldmVyeSB0eXBlIG9yIHZhbHVlIGNoYW5nZSB3aXRob3V0IHRvdWNoaW5nXG4vLyBPYnNpZGlhbidzIHJlbmRlciBwaXBlbGluZS5cbi8vXG4vLyBUaGUgYnV0dG9uIHRvZ2dsZXM6IHdpdGhvdXQgYSBzaG9ydGN1dCBpdCBvcGVucyB0aGUgcGlja2VyIChcInNxdWFyZS1mdW5jdGlvblwiKSxcbi8vIHdpdGggb25lIGl0IHJlbW92ZXMgaXQgKFwieFwiLCBvciB0aGUgd2FybmluZyB0cmlhbmdsZSBpZiB0aGUgc2NyaXB0IGlzXG4vLyBtaXNzaW5nIC0gc2VlIEJVVFRPTl9TVEFURVMpLiBUaGUgY2hpcCBpdHNlbGYgaXMgZm9yIENIQU5HSU5HIGl0LiBDU1Mgc2hvd3Ncbi8vIHRoZSBidXR0b24gb25seSBvbiByb3cgaG92ZXIvZm9jdXMgKGFuZCBwZXJtYW5lbnRseSB3aGlsZSBhIHNob3J0Y3V0IGlzXG4vLyBzZXQpIC0gb3RoZXJ3aXNlIGV2ZXJ5IHJvdyB3b3VsZCBjYXJyeSBhIGNvbnRyb2wgbW9zdCBuZXZlciBuZWVkLlxuLy9cbi8vIENhbGxlZCBhZ2FpbiB3aGVuZXZlciB0aGUgc2NyaXB0IGxpc3QgY2hhbmdlcyAoc2VlIHJlZnJlc2hTaG9ydGN1dENvbnRyb2xzXG4vLyBpbiB0eXAtcGFuZS5qcyksIHNvIHRoZSB3YXJuaW5nIGZvbGxvd3MgYSBzY3JpcHQgYmVpbmcgcmVuYW1lZCBvciByZXN0b3JlZC5cbi8vXG4vLyBIaWRpbmcgdGhlIHZhbHVlIGZpZWxkIHdoaWxlIGEgc2hvcnRjdXQgaXMgc2V0IGlzIHB1cmUgQ1NTIChST1dfQ0xBU1MgaW5cbi8vIHN0eWxlcy5jc3MpOyB0aGUgbmF0aXZlIHdpZGdldCBrZWVwcyByZW5kZXJpbmcgdW5kZXJuZWF0aC4gU2V0dGluZyBhbmRcbi8vIHJlbW92aW5nIGlzIGp1c3QgYSBjbGFzcyB0b2dnbGUsIG5vIHJlbmRlclByb3BlcnR5KCkvc3luY2hyb25pemUoKSAtIHdoaWNoXG4vLyB3b3VsZCBiZSByaXNreSBoZXJlIGFueXdheSAoc2VlIHN0cmlwVHlwUHJvcGVydHkpLlxuZnVuY3Rpb24gcmVuZGVyU2hvcnRjdXRDb250cm9scyh2aWV3LCBlZGl0b3IsIHN0b3JlKSB7XG4gIGNvbnN0IHNob3J0Y3V0cyA9IHN0b3JlLmdldFNob3J0Y3V0cygpO1xuICAvLyBCZWZvcmUgdGhlIHNjcmlwdCBmb2xkZXIgd2FzIHJlYWQgb25jZSwgbm90aGluZyBjb3VudHMgYXMgbWlzc2luZyAtXG4gIC8vIG90aGVyd2lzZSBldmVyeSBcInRwLlwiIHNob3J0Y3V0IHdvdWxkIGZsYXNoIHRoZSB3YXJuaW5nIG9uIHN0YXJ0dXAuXG4gIGNvbnN0IGdldFNjcmlwdHMgPSB2aWV3LnBsdWdpbi5nZXRTaG9ydGN1dFNjcmlwdHM7XG4gIGNvbnN0IHNjcmlwdE5hbWVzID0gZ2V0U2NyaXB0cz8uaXNMb2FkZWQ/LigpID8gbmV3IFNldChnZXRTY3JpcHRzKCkubWFwKChzY3JpcHQpID0+IHNjcmlwdC5uYW1lKSkgOiBudWxsO1xuICBmb3IgKGNvbnN0IHJvdyBvZiBlZGl0b3IucmVuZGVyZWQgPz8gW10pIHtcbiAgICBjb25zdCBjb250YWluZXJFbCA9IHJvdy5jb250YWluZXJFbDtcbiAgICBjb25zdCBrZXkgPSByb3cuZW50cnk/LmtleSA/PyBcIlwiO1xuICAgIC8vIEFuIHVubmFtZWQgcm93IGNhbid0IGNhcnJ5IGEgc2hvcnRjdXQgLSB0aGVyZSBpcyBubyBrZXkgdG8gc3RvcmUgaXRcbiAgICAvLyB1bmRlci4gVGhlIGJ1dHRvbiBhcHBlYXJzIG9uY2UgaXQgaGFzIGEgbmFtZSAoZXZlcnkgY2hhbmdlIHBhc3Nlc1xuICAgIC8vIHRocm91Z2ggc2F2ZUZyb250bWF0dGVyIGFuZCBzbyB0aHJvdWdoIGhlcmUpLlxuICAgIGNvbnN0IHJlY29yZCA9IGtleSA9PT0gXCJcIiA/IG51bGwgOiBzaG9ydGN1dHNba2V5XSA/PyBudWxsO1xuICAgIGNvbnRhaW5lckVsLnRvZ2dsZUNsYXNzKFJPV19DTEFTUywgISFyZWNvcmQpO1xuXG4gICAgLy8gT2JzaWRpYW4ncyB3YXJuaW5nIHRyaWFuZ2xlIHNpdHMgYWJzb2x1dGVseSBhdCB0aGUgcm93J3MgcmlnaHQgZWRnZSAtXG4gICAgLy8gZXhhY3RseSB3aGVyZSB0aGUgc2hvcnRjdXQgYnV0dG9uIGdvZXMuIElmIHRoZSByb3cgc2hvd3MgYSB0eXBlIHdhcm5pbmdcbiAgICAvLyBhbmQgaGFzIE5PIHNob3J0Y3V0LCB0aGUgYnV0dG9uIGdpdmVzIHdheS4gV2l0aCBhIHNob3J0Y3V0IHNldCwgdGhlXG4gICAgLy8gYnV0dG9uIHN0YXlzIChpdCBpcyB0aGUgb25seSB3YXkgdG8gcmVtb3ZlIHRoZSBzaG9ydGN1dCkgYW5kIHRoZVxuICAgIC8vIHRyaWFuZ2xlIGdpdmVzIHdheSBpbnN0ZWFkIChzdHlsZXMuY3NzKTogaXQgd291bGQgdGhlbiByZWZlciB0byB0aGVcbiAgICAvLyBoaWRkZW4gZmFsbGJhY2sgdmFsdWUsIHdoaWNoIGNhbid0IGJlIGZpeGVkIHRoZXJlIGFueXdheS5cbiAgICBjb25zdCBtaXNtYXRjaCA9ICEhcm93LnR5cGVJbmZvICYmIHJvdy50eXBlSW5mby5leHBlY3RlZCAhPT0gcm93LnR5cGVJbmZvLmluZmVycmVkO1xuICAgIGNvbnRhaW5lckVsLnRvZ2dsZUNsYXNzKFdBUk5JTkdfQ0xBU1MsIG1pc21hdGNoICYmICFyZWNvcmQpO1xuXG4gICAgbGV0IGJ1dHRvbkVsID0gY29udGFpbmVyRWwucXVlcnlTZWxlY3RvcihgOnNjb3BlID4gLiR7QlVUVE9OX0NMQVNTfWApO1xuICAgIGlmIChrZXkgPT09IFwiXCIpIHtcbiAgICAgIGJ1dHRvbkVsPy5yZW1vdmUoKTtcbiAgICAgIGNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3IoYDpzY29wZSA+IC4ke0NISVBfQ0xBU1N9YCk/LnJlbW92ZSgpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmICghYnV0dG9uRWwpIHtcbiAgICAgIC8vIEljb24gYW5kIGxhYmVsIGZvbGxvdyBiZWxvdywgcGVyIHN0YXRlLlxuICAgICAgYnV0dG9uRWwgPSBjb250YWluZXJFbC5jcmVhdGVEaXYoeyBjbHM6IGBjbGlja2FibGUtaWNvbiAke0JVVFRPTl9DTEFTU31gIH0pO1xuICAgICAgLy8gUmVhZCB0aGUga2V5IG9uIGNsaWNrLCBub3QgaGVyZTogYSByZW5hbWUgY2hhbmdlcyByb3cuZW50cnkua2V5XG4gICAgICAvLyB3aXRob3V0IHJlY3JlYXRpbmcgdGhlIHJvdy5cbiAgICAgIGJ1dHRvbkVsLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XG4gICAgICAgIGlmIChzdG9yZS5nZXRTaG9ydGN1dHMoKVtyb3cuZW50cnk/LmtleSA/PyBcIlwiXSkgcmVtb3ZlU2hvcnRjdXQodmlldywgZWRpdG9yLCBzdG9yZSwgcm93KTtcbiAgICAgICAgZWxzZSBvcGVuU2hvcnRjdXRQaWNrZXIodmlldywgZWRpdG9yLCBzdG9yZSwgcm93KTtcbiAgICAgIH0pO1xuICAgIH1cbiAgICBjb25zdCBzY3JpcHROYW1lID0gcmVjb3JkID8gc2NyaXB0TmFtZU9mKHJlY29yZC5uYW1lKSA6IG51bGw7XG4gICAgY29uc3QgbWlzc2luZyA9IHNjcmlwdE5hbWUgIT09IG51bGwgJiYgc2NyaXB0TmFtZXMgIT09IG51bGwgJiYgIXNjcmlwdE5hbWVzLmhhcyhzY3JpcHROYW1lKTtcbiAgICBjb25zdCBzdGF0ZSA9ICFyZWNvcmQgPyBcIm5vbmVcIiA6IG1pc3NpbmcgPyBcIm1pc3NpbmdcIiA6IFwic2V0XCI7XG4gICAgLy8gT25seSBvbiBhIGNoYW5nZTogc2V0SWNvbiB3b3VsZCByZXBsYWNlIHRoZSBTVkcgb24gZXZlcnkgY2FsbC5cbiAgICBpZiAoYnV0dG9uRWwuZGF0YXNldC50eXBTdGF0ZSAhPT0gc3RhdGUpIHtcbiAgICAgIGJ1dHRvbkVsLmRhdGFzZXQudHlwU3RhdGUgPSBzdGF0ZTtcbiAgICAgIHNldEljb24oYnV0dG9uRWwsIEJVVFRPTl9TVEFURVNbc3RhdGVdLmljb24pO1xuICAgICAgYnV0dG9uRWwuc2V0QXR0cihcImFyaWEtbGFiZWxcIiwgQlVUVE9OX1NUQVRFU1tzdGF0ZV0ubGFiZWwpO1xuICAgICAgYnV0dG9uRWwudG9nZ2xlQ2xhc3MoTUlTU0lOR19DTEFTUywgc3RhdGUgPT09IFwibWlzc2luZ1wiKTtcbiAgICB9XG5cbiAgICBsZXQgY2hpcEVsID0gY29udGFpbmVyRWwucXVlcnlTZWxlY3RvcihgOnNjb3BlID4gLiR7Q0hJUF9DTEFTU31gKTtcbiAgICBpZiAoIXJlY29yZCkge1xuICAgICAgY2hpcEVsPy5yZW1vdmUoKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoIWNoaXBFbCkge1xuICAgICAgY2hpcEVsID0gY3JlYXRlRWwoXCJjb2RlXCIsIHsgY2xzOiBDSElQX0NMQVNTIH0pO1xuICAgICAgLy8gVGV4dCBpbiBpdHMgb3duIHNwYW46IHRoZSBjaGlwIGlzIGEgZmxleCBjb250YWluZXIgKHZlcnRpY2FsXG4gICAgICAvLyBjZW50ZXJpbmcgbGlrZSB0aGUgcmVhbCB2YWx1ZSBmaWVsZCksIGFuZCB0ZXh0LW92ZXJmbG93OiBlbGxpcHNpc1xuICAgICAgLy8gb25seSB3b3JrcyBvbiBhIGJsb2NrIGVsZW1lbnQuXG4gICAgICBjaGlwRWwuY3JlYXRlU3Bhbih7IGNsczogQ0hJUF9URVhUX0NMQVNTIH0pO1xuICAgICAgY2hpcEVsLnNldEF0dHIoXCJhcmlhLWxhYmVsXCIsIFwiQ2hhbmdlIHNob3J0Y3V0XCIpO1xuICAgICAgY2hpcEVsLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiBvcGVuU2hvcnRjdXRQaWNrZXIodmlldywgZWRpdG9yLCBzdG9yZSwgcm93KSk7XG4gICAgICAvLyBCZWZvcmUgdGhlIGJ1dHRvbiwgc28gdGhlIHJvdyBhbHdheXMgcmVhZHMgXCJuYW1lIHwgY2hpcCB8IGJ1dHRvblwiLlxuICAgICAgY29udGFpbmVyRWwuaW5zZXJ0QmVmb3JlKGNoaXBFbCwgYnV0dG9uRWwpO1xuICAgIH1cbiAgICBjaGlwRWwuZmlyc3RFbGVtZW50Q2hpbGQuc2V0VGV4dChzaG9ydGN1dExhYmVsKHJlY29yZCkpO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIG9wZW5TaG9ydGN1dFBpY2tlcih2aWV3LCBlZGl0b3IsIHN0b3JlLCByb3cpIHtcbiAgY29uc3Qga2V5ID0gcm93LmVudHJ5Py5rZXkgPz8gXCJcIjtcbiAgaWYgKGtleSA9PT0gXCJcIikgcmV0dXJuO1xuICAvLyBQYXNzaW5nIHRoZSBjdXJyZW50IHJlY29yZCBwcmVmaWxscyB0aGUgYXJndW1lbnQgZGlhbG9nIHdoZW4gdGhlIHNhbWVcbiAgLy8gc2NyaXB0IGlzIHBpY2tlZCBhZ2FpbiAtIHRoYXQgaXMgaG93IHNpbmdsZSBhcmd1bWVudHMgZ2V0IGNvcnJlY3RlZC5cbiAgY29uc3QgcmVjb3JkID0gYXdhaXQgcGlja1Nob3J0Y3V0KHZpZXcuYXBwLCBrZXksIHZpZXcucGx1Z2luLmdldFNob3J0Y3V0U2NyaXB0cywgc3RvcmUuZ2V0U2hvcnRjdXRzKClba2V5XSA/PyBudWxsKTtcbiAgaWYgKCFyZWNvcmQpIHJldHVybjtcbiAgLy8gVGhlIHByb3BlcnR5IG1heSBoYXZlIHZhbmlzaGVkIHdoaWxlIHRoZSBkaWFsb2cgd2FzIG9wZW4gKHZpZXcgcmVidWlsdCkuXG4gIC8vIFdpdGhvdXQgdGhpcyBjaGVjayB0aGUgc2hvcnRjdXQgd291bGQgYmUgYW4gaW52aXNpYmxlIG9ycGhhbiBpbiB0aGVcbiAgLy8gc2V0dGluZ3MgdGhhdCBub3RoaW5nIGV2ZXIgY2xlYW5zIHVwLlxuICBpZiAoIU9iamVjdC5oYXNPd24oc3RvcmUuZ2V0RnJvbnRtYXR0ZXIoKSwga2V5KSkgcmV0dXJuO1xuICBzdG9yZS5zZXRTaG9ydGN1dHMoeyAuLi5zdG9yZS5nZXRTaG9ydGN1dHMoKSwgW2tleV06IHJlY29yZCB9KTtcbiAgc2F2ZVNob3J0Y3V0cyh2aWV3LCBlZGl0b3IsIHN0b3JlKTtcbn1cblxuZnVuY3Rpb24gcmVtb3ZlU2hvcnRjdXQodmlldywgZWRpdG9yLCBzdG9yZSwgcm93KSB7XG4gIGNvbnN0IGtleSA9IHJvdy5lbnRyeT8ua2V5ID8/IFwiXCI7XG4gIGNvbnN0IHNob3J0Y3V0cyA9IHsgLi4uc3RvcmUuZ2V0U2hvcnRjdXRzKCkgfTtcbiAgaWYgKCEoa2V5IGluIHNob3J0Y3V0cykpIHJldHVybjtcbiAgY29uc3Qgc25hcHNob3QgPSBzbmFwc2hvdFNldHRpbmdzKHZpZXcucGx1Z2luKTtcbiAgZGVsZXRlIHNob3J0Y3V0c1trZXldO1xuICBzdG9yZS5zZXRTaG9ydGN1dHMoc2hvcnRjdXRzKTtcbiAgc2F2ZVNob3J0Y3V0cyh2aWV3LCBlZGl0b3IsIHN0b3JlKTtcbiAgb2ZmZXJVbmRvKHZpZXcucGx1Z2luLCBgU2hvcnRjdXQgcmVtb3ZlZCBmcm9tIFwiJHtrZXl9XCIuYCwgc25hcHNob3QpO1xufVxuXG5mdW5jdGlvbiBzYXZlU2hvcnRjdXRzKHZpZXcsIGVkaXRvciwgc3RvcmUpIHtcbiAgdmlldy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gIHJlbmRlclNob3J0Y3V0Q29udHJvbHModmlldywgZWRpdG9yLCBzdG9yZSk7XG59XG5cbi8vIEEgc2ltcGxlIFwiYWRkIHByb3BlcnR5XCIgaW5zdGVhZCBvZiB0aGUgaW50ZXJuYWwgZWRpdG9yLmFkZFByb3BlcnR5KCk6IGFkZHNcbi8vIGFuIGVtcHR5IGtleSB3aXRoIHZhbHVlIG51bGwgYW5kIGxldHMgdGhlIHdpZGdldCByZW5kZXIgaXQgbm9ybWFsbHkgKHNhbWVcbi8vIGxvb2sgYXMgaW4gYSBub3RlLCBzaW5jZSBzeW5jaHJvbml6ZSgpIHJ1bnMgT2JzaWRpYW4ncyBvd24gcGlwZWxpbmUpLCB0aGVuXG4vLyBmb2N1c2VzIHRoZSBuZXcga2V5IGZpZWxkLlxuZnVuY3Rpb24gYWRkQmxhbmtQcm9wZXJ0eShlZGl0b3IpIHtcbiAgaWYgKCFlZGl0b3IpIHJldHVybjtcbiAgY29uc3QgY3VycmVudCA9IGVkaXRvci5zZXJpYWxpemUoKTtcbiAgaWYgKCFjdXJyZW50Lmhhc093blByb3BlcnR5KFwiXCIpKSB7XG4gICAgY3VycmVudFtcIlwiXSA9IG51bGw7XG4gICAgZWRpdG9yLnN5bmNocm9uaXplKGN1cnJlbnQpO1xuICAgIC8vIEV4aXN0aW5nIHJvd3Mga2VlcCB0aGVpciBidXR0b24gKGl0IHNpdHMgb24gY29udGFpbmVyRWwpLCB0aGUgbmV3IG9uZVxuICAgIC8vIG5lZWRzIG9uZS5cbiAgICByZW5kZXJTaG9ydGN1dENvbnRyb2xzKGVkaXRvci5vd25lci50eXBQYW5lLCBlZGl0b3IsIGVkaXRvci5vd25lci50eXBTdG9yZSk7XG4gIH1cbiAgZWRpdG9yLmZvY3VzS2V5KFwiXCIpO1xuICAvLyBDb3ZlcnMgdGhlIGNhc2Ugd2hlcmUgbW91bnRGcm9udG1hdHRlckVkaXRvcigpIGZvdW5kIG5vIHJvdyBjbGFzcyB0byBwYXRjaFxuICAvLyAoZW1wdHkgVFlQLCBubyBvcGVuIG5vdGUpIC0gbm93IHRoZXJlIGlzIGF0IGxlYXN0IG9uZSByb3cuXG4gIGVuc3VyZVByb3BlcnR5TWVudVBhdGNoKGVkaXRvci5vd25lci5hcHAsIGVkaXRvcik7XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICBtb3VudEZyb250bWF0dGVyRWRpdG9yLFxuICBhZGRCbGFua1Byb3BlcnR5LFxuICByZW5kZXJTaG9ydGN1dENvbnRyb2xzLFxuICBlbnN1cmVQcm9wZXJ0eU1lbnVQYXRjaCxcbiAgcmVtb3ZlUHJvcGVydHlNZW51UGF0Y2gsXG4gIHR5cFN0b3JlLFxuICBzdWJ0eXBTdG9yZSxcbn07XG4iLCAiY29uc3QgeyBtb3VudEZyb250bWF0dGVyRWRpdG9yLCBhZGRCbGFua1Byb3BlcnR5LCB0eXBTdG9yZSwgc3VidHlwU3RvcmUgfSA9IHJlcXVpcmUoXCIuL3R5cC1mcm9udG1hdHRlci1lZGl0b3JcIik7XG5jb25zdCB7IGdldFNlY3Rpb25PcmRlciwgaXNFbXB0eVZhbHVlIH0gPSByZXF1aXJlKFwiLi9zdWJ0eXBzXCIpO1xuXG4vKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAqIFRoZSBmcm9udG1hdHRlciBibG9ja3Mgb2YgYSBUWVAgaW4gdGhlIFRZUC1QYW5lIGRldGFpbCAoc2VlXG4gKiByZW5kZXJUeXBTZXR0aW5ncyBpbiB0eXAtcGFuZS5qcyk6IHRoZSBUWVAtRnJvbnRtYXR0ZXIgb24gdG9wLFxuICogYmVsb3cgaXQgb25lIGJsb2NrIHBlciByZWdpc3RlcmVkIFN1YnR5cC5cbiAqXG4gKiBFYWNoIGJsb2NrIGhhcyBpdHMgb3duIGluc3RhbmNlIG9mIE9ic2lkaWFuJ3MgcHJvcGVydHkgZWRpdG9yLFxuICogYm91bmQgdG8gdHlwU3RvcmUgb3Igc3VidHlwU3RvcmUgKHNlZSB0eXAtZnJvbnRtYXR0ZXItZWRpdG9yLmpzKS5cbiAqIFRoYXQgaXMgd2hhdCBsZXRzIHRoZSBzYW1lIGtleSBhcHBlYXIgaW4gc2V2ZXJhbCBibG9ja3MgLSBvbmVcbiAqIHNoYXJlZCBlZGl0b3Igd291bGQgaG9sZCBldmVyeXRoaW5nIGluIGEgc2luZ2xlIGZsYXQgb2JqZWN0LlxuICpcbiAqIE9ic2lkaWFuJ3Mgcm93IGRyYWcgb25seSB3b3JrcyB3aXRoaW4gb25lIGluc3RhbmNlLCBzb1xuICogcmVnaXN0ZXJQcm9wZXJ0eURyYWcoKSBiZWxvdyBidWlsZHMgb24gdGhhdCBkcmFnIHRvIG1vdmUgYVxuICogcHJvcGVydHkgYmV0d2VlbiBibG9ja3MuIEtleWJvYXJkIG5hdmlnYXRpb24gYWNyb3NzIGJsb2NrcyBpc1xuICogcmVnaXN0ZXJGb2N1c0NoYWluKCkgaW4gdHlwLWZyb250bWF0dGVyLWVkaXRvci5qcy5cbiAqXG4gKiBTZWN0aW9uOiBudWxsID0gVFlQLUZyb250bWF0dGVyLCBvdGhlcndpc2UgdGhlIFN1YnR5cCBuYW1lLlxuICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovXG5cbi8vIEEgd2hvbGUgYmxvY2sgY2FuIGJlIGdyYWJiZWQgYW55d2hlcmUgb3V0c2lkZSBpdHMgcHJvcGVydHkgcm93cyAtIGhlYWRpbmcsXG4vLyBmb290ZXIsIHNpZGUgbWFyZ2lucy4gQ29udHJvbHMgYW5kIGEgdGl0bGUgYmVpbmcgZWRpdGVkIGFyZSBleGNsdWRlZC5cbmZ1bmN0aW9uIGlzR3JhYlRhcmdldCh0YXJnZXQpIHtcbiAgaWYgKHRhcmdldC5jbG9zZXN0KFwiLmNsaWNrYWJsZS1pY29uLCAudHlwLXN1YnR5cC1jb2xvci1kb3QsIFtjb250ZW50ZWRpdGFibGU9J3RydWUnXSwgaW5wdXQsIHRleHRhcmVhXCIpKSByZXR1cm4gZmFsc2U7XG4gIHJldHVybiAhdGFyZ2V0LmNsb3Nlc3QoXCIubWV0YWRhdGEtcHJvcGVydHlcIik7XG59XG5cbi8vIHJlbmRlckhlYWRlcihzZWN0aW9uLCBlbCwgYmxvY2tzKSAvIHJlbmRlckZvb3RlcihzZWN0aW9uLCBlbCwgYmxvY2tzKSBmaWxsIGFcbi8vIGJsb2NrJ3MgaGVhZGluZyBhbmQgZm9vdGVyLiBvbk1vdmVTZWN0aW9uKG9yZGVyKSByZXBvcnRzIHRoZSBuZXcgYmxvY2sgb3JkZXJcbi8vIGFmdGVyIGEgYmxvY2sgZHJhZyAoc2hhcGVkIGxpa2UgZ2V0U2VjdGlvbk9yZGVyLCBsZWFkaW5nIG51bGwgaW5jbHVkZWQpLlxuZnVuY3Rpb24gbW91bnRGcm9udG1hdHRlckJsb2Nrcyh2aWV3LCBjb250YWluZXJFbCwgdHlwLCB7IHJlbmRlckhlYWRlciwgcmVuZGVyRm9vdGVyLCBvbk1vdmVTZWN0aW9uIH0pIHtcbiAgY29uc3Qgd3JhcHBlciA9IGNvbnRhaW5lckVsLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtYmxvY2tzXCIgfSk7XG4gIGNvbnN0IHNlY3Rpb25zID0gZ2V0U2VjdGlvbk9yZGVyKHZpZXcucGx1Z2luLnNldHRpbmdzLCB0eXApO1xuICBjb25zdCBlZGl0b3JzID0gbmV3IE1hcCgpO1xuICBjb25zdCBibG9ja0VscyA9IG5ldyBNYXAoKTtcbiAgY29uc3Qgc3RvcmVzID0gbmV3IE1hcCgpO1xuXG4gIGNvbnN0IGFwaSA9IHtcbiAgICAvLyBBbGwgZWRpdG9yIGluc3RhbmNlcyBpbiBibG9jayBvcmRlcjsgdHlwLXBhbmUuanMgYWRkcyB0aGVtIGFzIGNvbXBvbmVudFxuICAgIC8vIGNoaWxkcmVuIGFuZCB1bmxvYWRzIHRoZW0gYmVmb3JlIGVhY2ggcmVidWlsZC5cbiAgICBlZGl0b3JzOiBbXSxcbiAgICAvLyBBZGRzIGEgYmxhbmsgcm93IGF0IHRoZSBlbmQgb2YgdGhlIGJsb2NrIHdpdGggZm9jdXMgaW4gdGhlIGtleSBmaWVsZFxuICAgIC8vIChzZWUgYWRkQmxhbmtQcm9wZXJ0eSkuIGZsb2F0aW5nIG1hcmtzIHRoZSBuZXh0IG5hbWVkIHByb3BlcnR5IGFzXG4gICAgLy8gZmxvYXRpbmcuXG4gICAgYWRkQmxhbmsoc2VjdGlvbiwgZmxvYXRpbmcgPSBmYWxzZSkge1xuICAgICAgY29uc3QgZWRpdG9yID0gZWRpdG9ycy5nZXQoc2VjdGlvbik7XG4gICAgICBpZiAoIWVkaXRvcikgcmV0dXJuO1xuICAgICAgZWRpdG9yLnR5cFBlbmRpbmdGbG9hdGluZ0FkZCA9IGZsb2F0aW5nO1xuICAgICAgYWRkQmxhbmtQcm9wZXJ0eShlZGl0b3IpO1xuICAgIH0sXG4gIH07XG5cbiAgLy8gTmV4dCBibG9jayBpbiBkaXJlY3Rpb24gc3RlcCB0aGF0IGhhcyBhIHJvdyB0byBqdW1wIHRvOyBlbXB0eSBibG9ja3MgYXJlXG4gIC8vIHNraXBwZWQuXG4gIGNvbnN0IGZvY3VzTmVpZ2hib3IgPSAoc2VjdGlvbiwgc3RlcCkgPT4ge1xuICAgIGZvciAobGV0IGkgPSBzZWN0aW9ucy5pbmRleE9mKHNlY3Rpb24pICsgc3RlcDsgaSA+PSAwICYmIGkgPCBzZWN0aW9ucy5sZW5ndGg7IGkgKz0gc3RlcCkge1xuICAgICAgY29uc3QgZWRpdG9yID0gZWRpdG9ycy5nZXQoc2VjdGlvbnNbaV0pO1xuICAgICAgaWYgKCFlZGl0b3IgfHwgZWRpdG9yLnJlbmRlcmVkLmxlbmd0aCA9PT0gMCkgY29udGludWU7XG4gICAgICBlZGl0b3IuZm9jdXNQcm9wZXJ0eUF0SW5kZXgoc3RlcCA+IDAgPyAwIDogLTEpO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbiAgfTtcblxuICBmb3IgKGNvbnN0IHNlY3Rpb24gb2Ygc2VjdGlvbnMpIHtcbiAgICBjb25zdCBpc1N1YiA9IHNlY3Rpb24gIT09IG51bGw7XG4gICAgY29uc3QgYmxvY2tFbCA9IHdyYXBwZXIuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJ0eXAtYmxvY2tcIiArIChpc1N1YiA/IFwiIHR5cC1mcm9udG1hdHRlci1ibG9jayB0eXAtc3VidHlwLWJsb2NrXCIgOiBcIlwiKSxcbiAgICB9KTtcbiAgICBibG9ja0Vscy5zZXQoc2VjdGlvbiwgYmxvY2tFbCk7XG4gICAgYmxvY2tFbC50eXBTZWN0aW9uID0gc2VjdGlvbjtcblxuICAgIGNvbnN0IGhlYWRlciA9IGJsb2NrRWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1mcm9udG1hdHRlci1oZWFkZXIgdHlwLXNlY3Rpb24taGVhZGVyXCIgfSk7XG4gICAgaGVhZGVyLnRvZ2dsZUNsYXNzKFwidHlwLXNlY3Rpb24tc3ViXCIsIGlzU3ViKTtcblxuICAgIGNvbnN0IHN0b3JlID0gc2VjdGlvbiA9PT0gbnVsbCA/IHR5cFN0b3JlKHZpZXcucGx1Z2luLCB0eXApIDogc3VidHlwU3RvcmUodmlldy5wbHVnaW4sIHR5cCwgc2VjdGlvbik7XG4gICAgc3RvcmVzLnNldChzZWN0aW9uLCBzdG9yZSk7XG4gICAgY29uc3QgZWRpdG9yID0gbW91bnRGcm9udG1hdHRlckVkaXRvcih2aWV3LCBibG9ja0VsLCBzdG9yZSwge1xuICAgICAgb25TaGlmdEZvY3VzOiAoc3RlcCkgPT4gZm9jdXNOZWlnaGJvcihzZWN0aW9uLCBzdGVwKSxcbiAgICB9KTtcbiAgICBpZiAoZWRpdG9yKSB7XG4gICAgICBlZGl0b3JzLnNldChzZWN0aW9uLCBlZGl0b3IpO1xuICAgICAgYXBpLmVkaXRvcnMucHVzaChlZGl0b3IpO1xuICAgIH1cblxuICAgIGNvbnN0IGZvb3RlciA9IGJsb2NrRWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1zZWN0aW9uLWZvb3RlclwiIH0pO1xuICAgIGZvb3Rlci50b2dnbGVDbGFzcyhcInR5cC1zZWN0aW9uLXN1YlwiLCBpc1N1Yik7XG4gICAgcmVuZGVySGVhZGVyKHNlY3Rpb24sIGhlYWRlciwgYXBpKTtcbiAgICByZW5kZXJGb290ZXI/LihzZWN0aW9uLCBmb290ZXIsIGFwaSk7XG5cbiAgICBpZiAoIWlzU3ViKSBjb250aW51ZTtcbiAgICBibG9ja0VsLmFkZEV2ZW50TGlzdGVuZXIoXCJtb3VzZWRvd25cIiwgKGV2ZW50KSA9PiBzdGFydEJsb2NrRHJhZyhldmVudCwgc2VjdGlvbikpO1xuICB9XG5cbiAgLy8gTW91c2UgZHJhZyBpbnN0ZWFkIG9mIEhUTUw1IGRyYWdnYWJsZTogYSBkcmFnZ2FibGUgYW5jZXN0b3IgYnJva2UgdGV4dFxuICAvLyBzZWxlY3Rpb24gaW4gdGhlIHJvdyBpbnB1dHMuIFN0YXJ0cyBhZnRlciBhIGZldyBwaXhlbHM7IGFuIGFjY2VudCBsaW5lXG4gIC8vIHNob3dzIHRoZSB0YXJnZXQgZ2FwLCBFc2NhcGUgY2FuY2Vscy4gVGhlIFRZUC1Gcm9udG1hdHRlciBpcyBmaXhlZCBvbiB0b3BcbiAgLy8gKHNlZSBnZXRTZWN0aW9uT3JkZXIpLCBzbyB0YXJnZXQgMCBkb2Vzbid0IGV4aXN0LlxuICBmdW5jdGlvbiBzdGFydEJsb2NrRHJhZyhldmVudCwgc2VjdGlvbikge1xuICAgIGlmIChldmVudC5idXR0b24gIT09IDAgfHwgIWlzR3JhYlRhcmdldChldmVudC50YXJnZXQpKSByZXR1cm47XG4gICAgY29uc3Qgd2luID0gd3JhcHBlci53aW47XG4gICAgY29uc3Qgc3RhcnRZID0gZXZlbnQuY2xpZW50WTtcbiAgICBsZXQgZHJhZ2dpbmcgPSBmYWxzZTtcbiAgICBsZXQgaW5kaWNhdG9yID0gbnVsbDtcbiAgICBsZXQgYm94ZXMgPSBbXTtcbiAgICBsZXQgdGFyZ2V0SW5kZXggPSBudWxsO1xuXG4gICAgY29uc3QgbWVhc3VyZSA9ICgpID0+IHtcbiAgICAgIGNvbnN0IGJhc2UgPSB3cmFwcGVyLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgICAgYm94ZXMgPSBzZWN0aW9ucy5tYXAoKG5hbWUpID0+IHtcbiAgICAgICAgY29uc3QgcmVjdCA9IGJsb2NrRWxzLmdldChuYW1lKS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICAgICAgcmV0dXJuIHsgc2VjdGlvbjogbmFtZSwgdG9wOiByZWN0LnRvcCAtIGJhc2UudG9wLCBib3R0b206IHJlY3QuYm90dG9tIC0gYmFzZS50b3AgfTtcbiAgICAgIH0pO1xuICAgIH07XG5cbiAgICBjb25zdCBvbk1vdmUgPSAobW92ZUV2ZW50KSA9PiB7XG4gICAgICBpZiAoIWRyYWdnaW5nKSB7XG4gICAgICAgIGlmIChNYXRoLmFicyhtb3ZlRXZlbnQuY2xpZW50WSAtIHN0YXJ0WSkgPCA0KSByZXR1cm47XG4gICAgICAgIGRyYWdnaW5nID0gdHJ1ZTtcbiAgICAgICAgd3JhcHBlci5kb2MuYm9keS5hZGRDbGFzcyhcInR5cC1ibG9jay1kcmFnZ2luZ1wiKTtcbiAgICAgICAgd2luLmdldFNlbGVjdGlvbigpPy5yZW1vdmVBbGxSYW5nZXMoKTtcbiAgICAgICAgYmxvY2tFbHMuZ2V0KHNlY3Rpb24pLmFkZENsYXNzKFwiaXMtZHJhZ2dpbmdcIik7XG4gICAgICAgIG1lYXN1cmUoKTtcbiAgICAgICAgaW5kaWNhdG9yID0gd3JhcHBlci5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWJsb2NrLWRyb3AtaW5kaWNhdG9yXCIgfSk7XG4gICAgICB9XG4gICAgICBtb3ZlRXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgIGNvbnN0IHkgPSBtb3ZlRXZlbnQuY2xpZW50WSAtIHdyYXBwZXIuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCkudG9wO1xuICAgICAgdGFyZ2V0SW5kZXggPSBNYXRoLm1heCgxLCBib3hlcy5maWx0ZXIoKGJveCkgPT4gKGJveC50b3AgKyBib3guYm90dG9tKSAvIDIgPCB5KS5sZW5ndGgpO1xuICAgICAgY29uc3QgZnJvbSA9IGJveGVzLmZpbmRJbmRleCgoYm94KSA9PiBib3guc2VjdGlvbiA9PT0gc2VjdGlvbik7XG4gICAgICBpbmRpY2F0b3IudG9nZ2xlKHRhcmdldEluZGV4ICE9PSBmcm9tICYmIHRhcmdldEluZGV4ICE9PSBmcm9tICsgMSk7XG4gICAgICAvLyBNaWRkbGUgb2YgdGhlIGdhcCBiZXR3ZWVuIHR3byBibG9ja3MgKHNlZSAudHlwLWJsb2NrICsgLnR5cC1ibG9jayBpblxuICAgICAgLy8gc3R5bGVzLmNzcykuXG4gICAgICBjb25zdCBoYWxmR2FwID0gNjtcbiAgICAgIGNvbnN0IGdhcFkgPVxuICAgICAgICB0YXJnZXRJbmRleCA9PT0gYm94ZXMubGVuZ3RoXG4gICAgICAgICAgPyBib3hlc1tib3hlcy5sZW5ndGggLSAxXS5ib3R0b20gKyBoYWxmR2FwXG4gICAgICAgICAgOiAoYm94ZXNbdGFyZ2V0SW5kZXggLSAxXS5ib3R0b20gKyBib3hlc1t0YXJnZXRJbmRleF0udG9wKSAvIDI7XG4gICAgICBpbmRpY2F0b3Iuc3R5bGUudG9wID0gYCR7Z2FwWSAtIDF9cHhgO1xuICAgIH07XG5cbiAgICBjb25zdCBlbmQgPSAoY29tbWl0KSA9PiB7XG4gICAgICB3aW4ucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIm1vdXNlbW92ZVwiLCBvbk1vdmUpO1xuICAgICAgd2luLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJtb3VzZXVwXCIsIG9uVXApO1xuICAgICAgd2luLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIG9uS2V5LCB0cnVlKTtcbiAgICAgIGlmICghZHJhZ2dpbmcpIHJldHVybjtcbiAgICAgIHdyYXBwZXIuZG9jLmJvZHkucmVtb3ZlQ2xhc3MoXCJ0eXAtYmxvY2stZHJhZ2dpbmdcIik7XG4gICAgICBibG9ja0Vscy5nZXQoc2VjdGlvbikucmVtb3ZlQ2xhc3MoXCJpcy1kcmFnZ2luZ1wiKTtcbiAgICAgIGluZGljYXRvcj8ucmVtb3ZlKCk7XG5cbiAgICAgIGNvbnN0IG9yZGVyID0gYm94ZXMubWFwKChib3gpID0+IGJveC5zZWN0aW9uKTtcbiAgICAgIGNvbnN0IGZyb20gPSBvcmRlci5pbmRleE9mKHNlY3Rpb24pO1xuICAgICAgaWYgKCFjb21taXQgfHwgdGFyZ2V0SW5kZXggPT09IG51bGwgfHwgdGFyZ2V0SW5kZXggPT09IGZyb20gfHwgdGFyZ2V0SW5kZXggPT09IGZyb20gKyAxKSByZXR1cm47XG4gICAgICBvcmRlci5zcGxpY2UoZnJvbSwgMSk7XG4gICAgICBvcmRlci5zcGxpY2UoZnJvbSA8IHRhcmdldEluZGV4ID8gdGFyZ2V0SW5kZXggLSAxIDogdGFyZ2V0SW5kZXgsIDAsIHNlY3Rpb24pO1xuICAgICAgb25Nb3ZlU2VjdGlvbj8uKG9yZGVyKTtcbiAgICB9O1xuICAgIGNvbnN0IG9uVXAgPSAoKSA9PiBlbmQodHJ1ZSk7XG4gICAgY29uc3Qgb25LZXkgPSAoa2V5RXZlbnQpID0+IHtcbiAgICAgIGlmIChrZXlFdmVudC5rZXkgIT09IFwiRXNjYXBlXCIpIHJldHVybjtcbiAgICAgIGtleUV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBrZXlFdmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIGVuZChmYWxzZSk7XG4gICAgfTtcbiAgICB3aW4uYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNlbW92ZVwiLCBvbk1vdmUpO1xuICAgIHdpbi5hZGRFdmVudExpc3RlbmVyKFwibW91c2V1cFwiLCBvblVwKTtcbiAgICB3aW4uYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgb25LZXksIHRydWUpO1xuICB9XG5cbiAgcmVnaXN0ZXJQcm9wZXJ0eURyYWcoKTtcbiAgcmV0dXJuIGFwaTtcblxuICAvKiAtLS0gRHJhZ2dpbmcgYSBwcm9wZXJ0eSBpbnRvIGFub3RoZXIgYmxvY2sgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgKiBCdWlsdCBvbiBPYnNpZGlhbidzIG93biByb3cgZHJhZyByYXRoZXIgdGhhbiBhIHNlY29uZCBvbmUgbmV4dCB0byBpdDpcbiAgICogaXQgc3RhcnRzIGF0IHRoZSByb3cncyB0eXBlIGljb24sIHB1dHMgYSAuZHJhZy1yZW9yZGVyLWdob3N0IG9uIHRoZVxuICAgKiBib2R5IChzbyBpdCBmb2xsb3dzIHRoZSBjdXJzb3IgYWNyb3NzIGJsb2NrcyBhbnl3YXkpIGFuZCBtYXJrcyB0aGVcbiAgICogc291cmNlIHJvdyB3aXRoIC5kcmFnLWdob3N0LWhpZGRlbiwgdGhlIGFjY2VudCBib3ggc2hvd2luZyB0aGUgZHJvcFxuICAgKiBzcG90LiBXaXRoaW4gb25lIGJsb2NrIE9ic2lkaWFuIGRvZXMgZXZlcnl0aGluZyBhcyB1c3VhbC4gQWRkZWQgaGVyZTpcbiAgICpcbiAgICogIC0gYW4gZW1wdHkgZXh0cmEgY2hpbGQgaW4gdGhlIGxpc3Qgd2hpbGUgZHJhZ2dpbmc6IG90aGVyd2lzZSBPYnNpZGlhblxuICAgKiAgICBkb2Vzbid0IHN0YXJ0IHRoZSBkcmFnIGluIGEgYmxvY2sgd2l0aCBhIHNpbmdsZSByb3cgKGl0cyBtb3VzZWRvd25cbiAgICogICAgY2hlY2tzIG4uZmlyc3RDaGlsZCAhPT0gbi5sYXN0Q2hpbGQpO1xuICAgKiAgLSBhIHBsYWNlaG9sZGVyIHdpdGggdGhlIHNhbWUgLmRyYWctZ2hvc3QtaGlkZGVuIGNsYXNzIGluIHRoZSB0YXJnZXRcbiAgICogICAgYmxvY2sgb25jZSB0aGUgY3Vyc29yIHJlYWNoZXMgYW5vdGhlciBibG9jazsgdGhlIHNvdXJjZSByb3cgaXNcbiAgICogICAgaGlkZGVuIG1lYW53aGlsZSBzbyB0aGVyZSBhcmVuJ3QgdHdvIGJveGVzO1xuICAgKiAgLSBhIHJlb3JkZXJLZXkgcGVyIGluc3RhbmNlIHRoYXQgbW92ZXMgdGhlIHByb3BlcnR5IHRvIHRoZSBvdGhlclxuICAgKiAgICBibG9jayBvbiBkcm9wIGluc3RlYWQgb2Ygc29ydGluZyB3aXRoaW4gaXRzIG93bi5cbiAgICpcbiAgICogT3VyIGhhbmRsZXJzIHJ1biBpbiB0aGUgY2FwdHVyZSBwaGFzZSBvbiB0aGUgd2luZG93LCBiZWZvcmUgT2JzaWRpYW4nc1xuICAgKiAod2hpY2ggaXQgYWRkcyB0byB3aW5kb3cgaW4gaXRzIG1vdXNlZG93biBoYW5kbGVyKS5cbiAgICogLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gKi9cbiAgZnVuY3Rpb24gcmVnaXN0ZXJQcm9wZXJ0eURyYWcoKSB7XG4gICAgLy8gV2l0aG91dCBhIHNlY29uZCBibG9jayB0aGVyZSBpcyBubyB0YXJnZXQ7IE9ic2lkaWFuJ3MgZHJhZyBzdGF5cyBhcyBpcy5cbiAgICBjb25zdCBhbmNob3IgPSBhcGkuZWRpdG9yc1swXTtcbiAgICBpZiAoIWFuY2hvciB8fCBzZWN0aW9ucy5sZW5ndGggPCAyKSByZXR1cm47XG5cbiAgICAvLyBTdGF0ZSBvZiBhIHJ1bm5pbmcgZHJhZzsgZHJvcCBrZWVwcyB0aGUgdGFyZ2V0IGZvciB0aGUgcmVvcmRlcktleSBjYWxsXG4gICAgLy8gdGhhdCBmb2xsb3dzIHRoZSBtb3VzZXVwLlxuICAgIGxldCBkcmFnID0gbnVsbDtcbiAgICBsZXQgZHJvcCA9IG51bGw7XG5cbiAgICBjb25zdCBzZWN0aW9uQXQgPSAoY2xpZW50WSkgPT5cbiAgICAgIHNlY3Rpb25zLmZpbmQoKHNlY3Rpb24pID0+IHtcbiAgICAgICAgY29uc3QgcmVjdCA9IGJsb2NrRWxzLmdldChzZWN0aW9uKS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICAgICAgcmV0dXJuIGNsaWVudFkgPj0gcmVjdC50b3AgJiYgY2xpZW50WSA8PSByZWN0LmJvdHRvbTtcbiAgICAgIH0pO1xuXG4gICAgY29uc3QgY2xlYXJQbGFjZWhvbGRlciA9ICgpID0+IHtcbiAgICAgIGRyYWcucGxhY2Vob2xkZXI/LnJlbW92ZSgpO1xuICAgICAgZHJhZy5wbGFjZWhvbGRlciA9IG51bGw7XG4gICAgICBkcmFnLnJvd0VsLnN0eWxlLnJlbW92ZVByb3BlcnR5KFwiZGlzcGxheVwiKTtcbiAgICAgIGRyYWcudGFyZ2V0ID0gbnVsbDtcbiAgICB9O1xuXG4gICAgd3JhcHBlci5hZGRFdmVudExpc3RlbmVyKFxuICAgICAgXCJtb3VzZWRvd25cIixcbiAgICAgIChldmVudCkgPT4ge1xuICAgICAgICBpZiAoZXZlbnQuYnV0dG9uICE9PSAwKSByZXR1cm47XG4gICAgICAgIGNvbnN0IHJvd0VsID0gZXZlbnQudGFyZ2V0LmNsb3Nlc3QoXCIubWV0YWRhdGEtcHJvcGVydHktaWNvblwiKT8uY2xvc2VzdChcIi5tZXRhZGF0YS1wcm9wZXJ0eVwiKTtcbiAgICAgICAgY29uc3Qgc2VjdGlvbiA9IHJvd0VsPy5jbG9zZXN0KFwiLnR5cC1ibG9ja1wiKT8udHlwU2VjdGlvbjtcbiAgICAgICAgY29uc3QgZWRpdG9yID0gc2VjdGlvbiA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IGVkaXRvcnMuZ2V0KHNlY3Rpb24pO1xuICAgICAgICBjb25zdCBrZXkgPSBlZGl0b3I/LnJlbmRlcmVkLmZpbmQoKHJvdykgPT4gcm93LmNvbnRhaW5lckVsID09PSByb3dFbCk/LmVudHJ5LmtleTtcbiAgICAgICAgLy8gQW4gdW5uYW1lZCByb3cgaGFzIG5vIGJ1c2luZXNzIGluIGFub3RoZXIgYmxvY2s7IE9ic2lkaWFuIHNvcnRzIGl0LlxuICAgICAgICBpZiAoIWtleSkgcmV0dXJuO1xuICAgICAgICBkcmFnID0ge1xuICAgICAgICAgIHNlY3Rpb24sXG4gICAgICAgICAga2V5LFxuICAgICAgICAgIHJvd0VsLFxuICAgICAgICAgIC8vIE1lYXN1cmVkIG5vdzogb25jZSBoaWRkZW4gZm9yIHRoZSBwbGFjZWhvbGRlciwgb2Zmc2V0SGVpZ2h0IGlzIDAuXG4gICAgICAgICAgaGVpZ2h0OiByb3dFbC5vZmZzZXRIZWlnaHQsXG4gICAgICAgICAgc3BhY2VyOiBlZGl0b3IucHJvcGVydHlMaXN0RWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1kcmFnLXNwYWNlclwiIH0pLFxuICAgICAgICAgIHBsYWNlaG9sZGVyOiBudWxsLFxuICAgICAgICAgIHRhcmdldDogbnVsbCxcbiAgICAgICAgfTtcbiAgICAgICAgZHJvcCA9IG51bGw7XG4gICAgICB9LFxuICAgICAgdHJ1ZVxuICAgICk7XG5cbiAgICAvLyBPbiB0aGUgd2luZG93IHNvIGEgZHJhZyBpcyB0cmFja2VkIG91dHNpZGUgdGhlIGJsb2NrcyB0b287IHJlbW92ZWQgd2l0aFxuICAgIC8vIHRoZSBmaXJzdCBlZGl0b3IsIHdoaWNoIHVubG9hZHMgb24gdGhlIG5leHQgcmVidWlsZCBvZiB0aGUgZGV0YWlsIHZpZXcuXG4gICAgY29uc3Qgb25XaW5Nb3ZlID0gKGV2ZW50KSA9PiB7XG4gICAgICBpZiAoIWRyYWcpIHJldHVybjtcbiAgICAgIGNvbnN0IHRhcmdldCA9IHNlY3Rpb25BdChldmVudC5jbGllbnRZKTtcbiAgICAgIGlmICh0YXJnZXQgPT09IHVuZGVmaW5lZCB8fCB0YXJnZXQgPT09IGRyYWcuc2VjdGlvbikge1xuICAgICAgICBpZiAoZHJhZy5wbGFjZWhvbGRlcikgY2xlYXJQbGFjZWhvbGRlcigpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGxpc3QgPSBlZGl0b3JzLmdldCh0YXJnZXQpLnByb3BlcnR5TGlzdEVsO1xuICAgICAgaWYgKCFkcmFnLnBsYWNlaG9sZGVyKSB7XG4gICAgICAgIGRyYWcucm93RWwuc3R5bGUuZGlzcGxheSA9IFwibm9uZVwiO1xuICAgICAgICBkcmFnLnBsYWNlaG9sZGVyID0gY3JlYXRlRGl2KHsgY2xzOiBcIm1ldGFkYXRhLXByb3BlcnR5IGRyYWctZ2hvc3QtaGlkZGVuIHR5cC1kcmFnLXBsYWNlaG9sZGVyXCIgfSk7XG4gICAgICAgIGRyYWcucGxhY2Vob2xkZXIuc3R5bGUuaGVpZ2h0ID0gYCR7ZHJhZy5oZWlnaHR9cHhgO1xuICAgICAgfVxuICAgICAgLy8gRHJvcCBzcG90IGFzIE9ic2lkaWFuIGRvZXMgaXQ6IGJlZm9yZSB0aGUgZmlyc3Qgcm93IHdob3NlIG1pZGRsZSBpc1xuICAgICAgLy8gYmVsb3cgdGhlIGN1cnNvci5cbiAgICAgIGNvbnN0IHJvd3MgPSBbLi4ubGlzdC5jaGlsZHJlbl0uZmlsdGVyKChlbCkgPT4gZWwgIT09IGRyYWcucGxhY2Vob2xkZXIgJiYgZWwgIT09IGRyYWcuc3BhY2VyKTtcbiAgICAgIGNvbnN0IGJlZm9yZSA9IHJvd3MuZmluZCgoZWwpID0+IHtcbiAgICAgICAgY29uc3QgcmVjdCA9IGVsLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgICAgICByZXR1cm4gZXZlbnQuY2xpZW50WSA8IHJlY3QudG9wICsgcmVjdC5oZWlnaHQgLyAyO1xuICAgICAgfSk7XG4gICAgICBkcmFnLnRhcmdldCA9IHsgc2VjdGlvbjogdGFyZ2V0LCBpbmRleDogYmVmb3JlID8gcm93cy5pbmRleE9mKGJlZm9yZSkgOiByb3dzLmxlbmd0aCB9O1xuICAgICAgbGlzdC5pbnNlcnRCZWZvcmUoZHJhZy5wbGFjZWhvbGRlciwgYmVmb3JlID8/IG51bGwpO1xuICAgIH07XG5cbiAgICBjb25zdCBvbldpblVwID0gKCkgPT4ge1xuICAgICAgaWYgKCFkcmFnKSByZXR1cm47XG4gICAgICBjb25zdCB7IHNwYWNlciwgcGxhY2Vob2xkZXIsIHJvd0VsLCB0YXJnZXQgfSA9IGRyYWc7XG4gICAgICBkcmFnID0gbnVsbDtcbiAgICAgIGRyb3AgPSB0YXJnZXQ7XG4gICAgICBwbGFjZWhvbGRlcj8ucmVtb3ZlKCk7XG4gICAgICByb3dFbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShcImRpc3BsYXlcIik7XG4gICAgICAvLyBPbmx5IGFmdGVyIE9ic2lkaWFuIGZpbmlzaGVzIGl0cyBkcmFnOiBpdCBzdGlsbCByZWFkcyB0aGUgZHJvcCBzcG90XG4gICAgICAvLyBpbiB0aGUgc291cmNlIGJsb2NrIGZyb20gdGhlIGNoaWxkIGxpc3QsIHdoZXJlIHRoZSBzcGFjZXIgbWFya3MgdGhlXG4gICAgICAvLyBsYXN0IHBvc2l0aW9uLlxuICAgICAgd3JhcHBlci53aW4uc2V0VGltZW91dCgoKSA9PiBzcGFjZXIucmVtb3ZlKCksIDApO1xuICAgIH07XG5cbiAgICB3cmFwcGVyLndpbi5hZGRFdmVudExpc3RlbmVyKFwibW91c2Vtb3ZlXCIsIG9uV2luTW92ZSwgdHJ1ZSk7XG4gICAgd3JhcHBlci53aW4uYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNldXBcIiwgb25XaW5VcCwgdHJ1ZSk7XG4gICAgYW5jaG9yLnJlZ2lzdGVyKCgpID0+IHtcbiAgICAgIHdyYXBwZXIud2luLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJtb3VzZW1vdmVcIiwgb25XaW5Nb3ZlLCB0cnVlKTtcbiAgICAgIHdyYXBwZXIud2luLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJtb3VzZXVwXCIsIG9uV2luVXAsIHRydWUpO1xuICAgIH0pO1xuXG4gICAgZm9yIChjb25zdCBbc2VjdGlvbiwgZWRpdG9yXSBvZiBlZGl0b3JzKSB7XG4gICAgICBjb25zdCBvcmlnaW5hbFJlb3JkZXJLZXkgPSBlZGl0b3IucmVvcmRlcktleTtcbiAgICAgIGVkaXRvci5yZW9yZGVyS2V5ID0gZnVuY3Rpb24gKGVudHJ5LCBpbmRleCkge1xuICAgICAgICBjb25zdCB0YXJnZXQgPSBkcm9wO1xuICAgICAgICBkcm9wID0gbnVsbDtcbiAgICAgICAgaWYgKCF0YXJnZXQpIHJldHVybiBvcmlnaW5hbFJlb3JkZXJLZXkuY2FsbCh0aGlzLCBlbnRyeSwgaW5kZXgpO1xuICAgICAgICBtb3ZlUHJvcGVydHkoc2VjdGlvbiwgdGFyZ2V0LnNlY3Rpb24sIGVudHJ5LmtleSwgdGFyZ2V0LmluZGV4KTtcbiAgICAgIH07XG4gICAgfVxuICB9XG5cbiAgLy8gTW92ZXMga2V5IGZyb20gYmxvY2sgYGZyb21gIHRvIGJsb2NrIGB0b2AgYXQgcG9zaXRpb24gaW5kZXguIElmIHRoZSB0YXJnZXRcbiAgLy8gYWxyZWFkeSBoYXMgdGhlIG5hbWUgKHVuaXF1ZSB3aXRoaW4gYSBibG9jayksIHRoZSB0d28gbWVyZ2U6IHRoZSBleGlzdGluZ1xuICAvLyBlbnRyeSBrZWVwcyBwb3NpdGlvbiwgdmFsdWUsIGZsb2F0aW5nIGZsYWcgYW5kIHNob3J0Y3V0OyBvbmx5IGFuIGVtcHR5XG4gIC8vIHZhbHVlIGlzIGZpbGxlZCBmcm9tIHRoZSBkcmFnZ2VkIG9uZSAtIHNhbWUgcnVsZSBhcyBtZXJnZVN1YnR5cHNcbiAgLy8gKHN1YnR5cHMuanMpIGFuZCByZW5hbWVJblN0b3JlIChwcm9wZXJ0eS1yZW5hbWUtc3luYy5qcykuXG4gIGFzeW5jIGZ1bmN0aW9uIG1vdmVQcm9wZXJ0eShmcm9tLCB0bywga2V5LCBpbmRleCkge1xuICAgIGNvbnN0IHNvdXJjZSA9IHN0b3Jlcy5nZXQoZnJvbSk7XG4gICAgY29uc3QgdGFyZ2V0ID0gc3RvcmVzLmdldCh0byk7XG4gICAgaWYgKCFzb3VyY2UgfHwgIXRhcmdldCB8fCBmcm9tID09PSB0bykgcmV0dXJuO1xuXG4gICAgY29uc3Qgc291cmNlRnJvbnRtYXR0ZXIgPSB7IC4uLnNvdXJjZS5nZXRGcm9udG1hdHRlcigpIH07XG4gICAgY29uc3QgdmFsdWUgPSBzb3VyY2VGcm9udG1hdHRlcltrZXldO1xuICAgIGNvbnN0IHdhc0Zsb2F0aW5nID0gc291cmNlLmdldEZsb2F0aW5nKCkuaW5jbHVkZXMoa2V5KTtcbiAgICAvLyBUaGUgc2hvcnRjdXQgYmVsb25ncyB0byB0aGUga2V5IGFuZCBtb3ZlcyB3aXRoIGl0LlxuICAgIGNvbnN0IHNvdXJjZVNob3J0Y3V0cyA9IHsgLi4uc291cmNlLmdldFNob3J0Y3V0cygpIH07XG4gICAgY29uc3Qgc2hvcnRjdXQgPSBzb3VyY2VTaG9ydGN1dHNba2V5XSA/PyBudWxsO1xuICAgIGRlbGV0ZSBzb3VyY2VTaG9ydGN1dHNba2V5XTtcbiAgICBkZWxldGUgc291cmNlRnJvbnRtYXR0ZXJba2V5XTtcbiAgICBzb3VyY2Uuc2V0RnJvbnRtYXR0ZXIoc291cmNlRnJvbnRtYXR0ZXIpO1xuICAgIHNvdXJjZS5zZXRGbG9hdGluZyhzb3VyY2UuZ2V0RmxvYXRpbmcoKS5maWx0ZXIoKGspID0+IGsgIT09IGtleSkpO1xuICAgIHNvdXJjZS5zZXRTaG9ydGN1dHMoc291cmNlU2hvcnRjdXRzKTtcblxuICAgIGNvbnN0IHRhcmdldEZyb250bWF0dGVyID0gdGFyZ2V0LmdldEZyb250bWF0dGVyKCk7XG4gICAgY29uc3QgZXhpc3RpbmcgPSBPYmplY3Qua2V5cyh0YXJnZXRGcm9udG1hdHRlcikuZmluZCgoaykgPT4gay50b0xvd2VyQ2FzZSgpID09PSBrZXkudG9Mb3dlckNhc2UoKSk7XG4gICAgaWYgKGV4aXN0aW5nICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmIChpc0VtcHR5VmFsdWUodGFyZ2V0RnJvbnRtYXR0ZXJbZXhpc3RpbmddKSkgdGFyZ2V0LnNldEZyb250bWF0dGVyKHsgLi4udGFyZ2V0RnJvbnRtYXR0ZXIsIFtleGlzdGluZ106IHZhbHVlIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBrZXlzID0gT2JqZWN0LmtleXModGFyZ2V0RnJvbnRtYXR0ZXIpO1xuICAgICAgY29uc3QgYXQgPSBNYXRoLm1heCgwLCBNYXRoLm1pbihpbmRleCwga2V5cy5sZW5ndGgpKTtcbiAgICAgIGNvbnN0IG5leHQgPSB7fTtcbiAgICAgIGZvciAoY29uc3QgayBvZiBrZXlzLnNsaWNlKDAsIGF0KSkgbmV4dFtrXSA9IHRhcmdldEZyb250bWF0dGVyW2tdO1xuICAgICAgbmV4dFtrZXldID0gdmFsdWU7XG4gICAgICBmb3IgKGNvbnN0IGsgb2Yga2V5cy5zbGljZShhdCkpIG5leHRba10gPSB0YXJnZXRGcm9udG1hdHRlcltrXTtcbiAgICAgIHRhcmdldC5zZXRGcm9udG1hdHRlcihuZXh0KTtcbiAgICAgIGlmICh3YXNGbG9hdGluZykgdGFyZ2V0LnNldEZsb2F0aW5nKFsuLi50YXJnZXQuZ2V0RmxvYXRpbmcoKSwga2V5XSk7XG4gICAgICBpZiAoc2hvcnRjdXQpIHRhcmdldC5zZXRTaG9ydGN1dHMoeyAuLi50YXJnZXQuZ2V0U2hvcnRjdXRzKCksIFtrZXldOiBzaG9ydGN1dCB9KTtcbiAgICB9XG5cbiAgICBhd2FpdCB2aWV3LnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAvLyBCb3RoIGJsb2NrcyBjaGFuZ2VkLCBzbyB0aGlzIGRldGFpbCB2aWV3IGlzIHJlYnVpbHQgZnJvbSB0aGUgc2V0dGluZ3M7XG4gICAgLy8gdGhlIG90aGVyIHZpZXdzIG9ubHkgbmVlZCB0aGVpciBjb2xvcnMgYW5kIG1hcmtzIHJlZnJlc2hlZC5cbiAgICB2aWV3LnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzRXhjZXB0Py4odmlldyk7XG4gICAgdmlldy5yZW5kZXIoKTtcbiAgfVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgbW91bnRGcm9udG1hdHRlckJsb2NrcyB9O1xuIiwgImNvbnN0IHsgbW92ZVR5cFN1YnR5cHMsIGRlbGV0ZVR5cFN1YnR5cHMgfSA9IHJlcXVpcmUoXCIuL3N1YnR5cHNcIik7XG5cbi8vIFRoZSBwZXItVFlQIHRhYmxlcyBvZiB0aGUgc2V0dGluZ3MsIGVhY2gga2V5ZWQgYnkgVFlQIG5hbWUgLSB0aGUgb25lIGxpc3Rcbi8vIHRoYXQgcmVuYW1pbmcsIG1lcmdpbmcgYW5kIGRlbGV0aW5nIGEgVFlQIGdvIHRocm91Z2gsIHNvIGEgdGFibGUgYWRkZWQgbGF0ZXJcbi8vIGNhbid0IGJlIGZvcmdvdHRlbiBpbiBvbmUgb2YgdGhlbS4gdHlwU3VidHlwcyBpcyBoYW5kbGVkIHNlcGFyYXRlbHkgKHNlZVxuLy8gc3VidHlwcy5qcyk6IGEgbWVyZ2UgY29tYmluZXMgU3VidHlwIGJsb2NrcyBpbnN0ZWFkIG9mIGRyb3BwaW5nIHRoZW0uXG4vLyB0eXBNYW51YWwgbWF5IGJlIG1pc3NpbmcgaW4gb2xkZXIgc2V0dGluZ3MsIHNvIGEgdGFibGUgaXMgb25seSBjcmVhdGVkIHdoZW5cbi8vIHRoZXJlIGlzIHNvbWV0aGluZyB0byBtb3ZlIGludG8gaXQuXG5jb25zdCBUWVBfU0VUVElOR19UQUJMRVMgPSBbXG4gIFwidHlwQ29sb3JzXCIsXG4gIFwidHlwRGVzY3JpcHRpb25zXCIsXG4gIFwidHlwRGVmYXVsdEZyb250bWF0dGVyXCIsXG4gIFwidHlwRmxvYXRpbmdLZXlzXCIsXG4gIFwidHlwU2hvcnRjdXRzXCIsXG4gIFwidHlwTWFudWFsXCIsXG5dO1xuXG4vLyBSZW5hbWluZyBpbiB0aGUgc2V0dGluZ3M6IHRoZSBUWVAga2VlcHMgaXRzIHBsYWNlIGluIHNldHRpbmdzLnR5cHMgKHRoZVxuLy8gbWFudWFsIG9yZGVyKSwgZXZlcnkgdGFibGUgZW50cnkgYW5kIHRoZSBTdWJ0eXBzIG1vdmUgdG8gdGhlIG5ldyBuYW1lLlxuZnVuY3Rpb24gbW92ZVR5cFNldHRpbmdzKHNldHRpbmdzLCBmcm9tLCB0bykge1xuICBjb25zdCBpbmRleCA9IHNldHRpbmdzLnR5cHMuaW5kZXhPZihmcm9tKTtcbiAgaWYgKGluZGV4ICE9PSAtMSkgc2V0dGluZ3MudHlwc1tpbmRleF0gPSB0bztcbiAgZm9yIChjb25zdCB0YWJsZSBvZiBUWVBfU0VUVElOR19UQUJMRVMpIHtcbiAgICBpZiAoc2V0dGluZ3NbdGFibGVdPy5bZnJvbV0gPT09IHVuZGVmaW5lZCkgY29udGludWU7XG4gICAgc2V0dGluZ3NbdGFibGVdID8/PSB7fTtcbiAgICBzZXR0aW5nc1t0YWJsZV1bdG9dID0gc2V0dGluZ3NbdGFibGVdW2Zyb21dO1xuICAgIGRlbGV0ZSBzZXR0aW5nc1t0YWJsZV1bZnJvbV07XG4gIH1cbiAgbW92ZVR5cFN1YnR5cHMoc2V0dGluZ3MsIGZyb20sIHRvKTtcbn1cblxuLy8gUmVtb3ZlcyB0aGUgVFlQIGZyb20gdGhlIGxpc3QgYW5kIGZyb20gZXZlcnkgdGFibGUsIFN1YnR5cHMgaW5jbHVkZWQuXG5mdW5jdGlvbiBkZWxldGVUeXBTZXR0aW5ncyhzZXR0aW5ncywgdHlwKSB7XG4gIHNldHRpbmdzLnR5cHMgPSBzZXR0aW5ncy50eXBzLmZpbHRlcigodCkgPT4gdCAhPT0gdHlwKTtcbiAgZm9yIChjb25zdCB0YWJsZSBvZiBUWVBfU0VUVElOR19UQUJMRVMpIHtcbiAgICBpZiAoc2V0dGluZ3NbdGFibGVdKSBkZWxldGUgc2V0dGluZ3NbdGFibGVdW3R5cF07XG4gIH1cbiAgZGVsZXRlVHlwU3VidHlwcyhzZXR0aW5ncywgdHlwKTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IFRZUF9TRVRUSU5HX1RBQkxFUywgbW92ZVR5cFNldHRpbmdzLCBkZWxldGVUeXBTZXR0aW5ncyB9O1xuIiwgImNvbnN0IHsgSXRlbVZpZXcsIE1lbnUsIE5vdGljZSwgc2V0SWNvbiwgZGVib3VuY2UgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgQ29uZmlybU1vZGFsLCB0eXBOYW1lTm9kZSwgc3VidHlwTmFtZU5vZGUgfSA9IHJlcXVpcmUoXCIuL2NvbmZpcm0tbW9kYWxcIik7XG5jb25zdCB7IHNuYXBzaG90U2V0dGluZ3MsIG9mZmVyVW5kbyB9ID0gcmVxdWlyZShcIi4vdW5kb1wiKTtcbmNvbnN0IHsgbW91bnRGcm9udG1hdHRlckJsb2NrcyB9ID0gcmVxdWlyZShcIi4vZnJvbnRtYXR0ZXItYmxvY2tzXCIpO1xuY29uc3QgeyByZW5kZXJTaG9ydGN1dENvbnRyb2xzIH0gPSByZXF1aXJlKFwiLi90eXAtZnJvbnRtYXR0ZXItZWRpdG9yXCIpO1xuY29uc3QgeyBtb3ZlVHlwU2V0dGluZ3MsIGRlbGV0ZVR5cFNldHRpbmdzIH0gPSByZXF1aXJlKFwiLi90eXAtc2V0dGluZ3NcIik7XG5jb25zdCB7IHJ1bk9yUmVwb3J0RXJyb3IgfSA9IHJlcXVpcmUoXCIuL2NvbW1hbmRzXCIpO1xuY29uc3QgeyBpc0Jhc2VzRW5hYmxlZCwgY3JlYXRlQmFzZUZvciB9ID0gcmVxdWlyZShcIi4vYmFzZXNcIik7XG5jb25zdCB7IHJ1bkZyb250bWF0dGVyU29ydCB9ID0gcmVxdWlyZShcIi4vZnJvbnRtYXR0ZXItc29ydFwiKTtcbmNvbnN0IHtcbiAgbm9ybWFsaXplU3VidHlwTmFtZSxcbiAgZ2V0U3VidHlwTmFtZXMsXG4gIGVuc3VyZVN1YnR5cCxcbiAgbWVyZ2VUeXBTdWJ0eXBzLFxuICBnZXRTdWJ0eXAsXG4gIGlzU3VidHlwTWFudWFsLFxuICBzZXRTdWJ0eXBNYW51YWwsXG4gIHNldEFsbFN1YnR5cHNNYW51YWwsXG4gIHJlbmFtZVN1YnR5cCxcbiAgcmVvcmRlclN1YnR5cHMsXG4gIGRlbGV0ZVN1YnR5cCxcbiAgbWVyZ2VTdWJ0eXBzLFxuICByZW5hbWVTdWJ0eXBJbk5vdGVzLFxufSA9IHJlcXVpcmUoXCIuL3N1YnR5cHNcIik7XG5jb25zdCB7IG5vcm1hbGl6ZVR5cE5hbWUsIGNvbXBhcmVUeXBzLCBzb3J0VHlwc0J5TW9kZSwgcGx1cmFsLCBqb2luQW5kIH0gPSByZXF1aXJlKFwiLi90eXAtdXRpbHNcIik7XG5jb25zdCB7IHR5cEtleU9mLCBwcm9wZXJ0eVZhbHVlLCBzZXRDYW5vbmljYWxQcm9wZXJ0eSwgVFlQX1BST1BFUlRZLCBTVUJUWVBfUFJPUEVSVFkgfSA9IHJlcXVpcmUoXCIuL3R5cC1pbmRleFwiKTtcbmNvbnN0IHtcbiAgc3VidHlwQ29sb3IsXG4gIGFwcGx5Q29sb3JPZmZzZXQsXG4gIGhhc0NvbG9yT2Zmc2V0LFxuICBzdWJ0eXBIYXNPd25Db2xvcixcbiAgcGFpbnRDb2xvckRvdCxcbiAgbmFtZUNvbG9yLFxuICBjaGFubmVsQm91bmRzLFxuICBjbGFtcGVkT2Zmc2V0LFxuICBTVUJUWVBfQ09MT1JfQ0hBTk5FTFMsXG4gIERFRkFVTFRfVFlQX0NPTE9SLFxufSA9IHJlcXVpcmUoXCIuL3R5cC1jb2xvcnNcIik7XG5cbmNvbnN0IFZJRVdfVFlQRV9UWVBfUEFORSA9IFwidHlwLXN5c3RlbS1wYW5lXCI7XG5jb25zdCBERUZBVUxUX1NPUlRfT1JERVIgPSBcImNvdW50LWRlc2NcIjtcbmNvbnN0IERFRkFVTFRfU0VDT05EQVJZID0gXCJzdWJ0eXBzXCI7XG5cbi8vIFdoYXQgdGhlIFRZUC1MaXN0IHNob3dzIG5leHQgdG8gdGhlIG5hbWUgKHNldHRpbmdzLnR5cExpc3RTZWNvbmRhcnkpLFxuLy8gY3ljbGVkIGJ5IGEgaGVhZGVyIGJ1dHRvbiBuZXh0IHRvIHNvcnRpbmcgKHNlZSBjeWNsZVNlY29uZGFyeSkgLSB0b28gZmV3LFxuLy8gdG9vIGltbWVkaWF0ZWx5IHZpc2libGUgc3RhdGVzIGZvciBhIG1lbnUuXG4vLyAgIHN1YnR5cHMgICAgIC0gdGhlIFRZUCdzIFN1YnR5cHMgaW4gYnJhY2tldHMsIGVhY2ggaW4gaXRzIGNvbG9yIChsaWtlIHRoZVxuLy8gICAgICAgICAgICAgICAgIHByZXZpZXcgaW4gdGhlIHNlcGFyYXRlIFRZUC1QaWNrZXIpXG4vLyAgIGRlc2NyaXB0aW9uIC0gdGV4dCBmaWVsZCB0byBlZGl0IHRoZSBUWVAgZGVzY3JpcHRpb25cbi8vICAgbm9uZSAgICAgICAgLSBub3RoaW5nLCB0aGUgbmFtZSBnZXRzIHRoZSB3aG9sZSByb3dcbi8vIFRoZSBvcmRlciBpcyBhbHNvIHRoZSBjeWNsZSBvcmRlcjsgdGhlIGZpcnN0IGlzIHRoZSBkZWZhdWx0OiB0aGUgU3VidHlwc1xuLy8gYXBwZWFyIG5vd2hlcmUgZWxzZSBpbiB0aGUgbGlzdCwgdGhlIGRlc2NyaXB0aW9uIGFsc28gaW4gdGhlIGRldGFpbCB2aWV3LlxuY29uc3QgU0VDT05EQVJZX01PREVTID0gW1xuICB7IG1vZGU6IFwic3VidHlwc1wiLCB0aXRsZTogXCJTdWJ0eXAgbGlzdFwiLCBpY29uOiBcImxpc3QtdHJlZVwiIH0sXG4gIHsgbW9kZTogXCJkZXNjcmlwdGlvblwiLCB0aXRsZTogXCJEZXNjcmlwdGlvblwiLCBpY29uOiBcInRleHQtY3Vyc29yLWlucHV0XCIgfSxcbiAgeyBtb2RlOiBcIm5vbmVcIiwgdGl0bGU6IFwiTm90aGluZ1wiLCBpY29uOiBcIm1pbnVzXCIgfSxcbl07XG5cbmNvbnN0IFNPUlRfT1BUSU9OUyA9IFtcbiAgLy8gVW5saWtlIHRoZSBvdGhlcnMsIFwibWFudWFsXCIgaGFzIG5vIGNvbXBhcmlzb246IHRoZSBvcmRlciBvZiBzZXR0aW5ncy50eXBzXG4gIC8vIGl0c2VsZiBpcyB0aGUgc3RvcmFnZSAoc2VlIHJlbmRlcigpIGFuZCByZW5kZXJSZWdpc3RlcmVkSXRlbSgpIGZvciB0aGVcbiAgLy8gZHJhZyAmIGRyb3AgcmVuZGVyaW5nIGJ1aWx0IG9uIGl0KS4gRmlyc3Qgb24gcHVycG9zZSAtIGl0cyBvd24gZ3JvdXAgYXRcbiAgLy8gdGhlIHRvcCBvZiB0aGUgbWVudSAoc2VlIHNob3dTb3J0TWVudSkuXG4gIHsgbW9kZTogXCJtYW51YWxcIiwgdGl0bGU6IFwiTWFudWFsIChkcmFnICYgZHJvcClcIiB9LFxuICB7IG1vZGU6IFwiY291bnQtZGVzY1wiLCB0aXRsZTogXCJNb3N0IG5vdGVzIGZpcnN0XCIgfSxcbiAgeyBtb2RlOiBcImNvdW50LWFzY1wiLCB0aXRsZTogXCJGZXdlc3Qgbm90ZXMgZmlyc3RcIiB9LFxuICB7IG1vZGU6IFwibmFtZS1hc2NcIiwgdGl0bGU6IFwiTmFtZSAoQSB0byBaKVwiIH0sXG4gIHsgbW9kZTogXCJuYW1lLWRlc2NcIiwgdGl0bGU6IFwiTmFtZSAoWiB0byBBKVwiIH0sXG4gIHsgbW9kZTogXCJjb2xvci1hc2NcIiwgdGl0bGU6IFwiQ29sb3IgKHJlZCBcdTIxOTIgdmlvbGV0KVwiIH0sXG4gIHsgbW9kZTogXCJjb2xvci1kZXNjXCIsIHRpdGxlOiBcIkNvbG9yICh2aW9sZXQgXHUyMTkyIHJlZClcIiB9LFxuXTtcblxuLy8gUmV3cml0ZXMgdGhlIFRZUCBvZiBldmVyeSBub3RlIHdpdGgga2V5IG9sZEtleSAoc2VlIHR5cEtleU9mIGluXG4vLyB0eXAtaW5kZXguanMgLSB0aGUgVFlQIG5hbWUgZm9yIGEgY2xlYW4gdmFsdWUsIG90aGVyd2lzZSB0aGUgcmF3IGZvcm0gbGlrZVxuLy8gXCIgYnVjaFwiIG9yIFwiW1BFUlNPTiwgQlVDSF1cIikgdG8gdGhlIHNpbmdsZSB2YWx1ZSBuZXdWYWx1ZS4gVXNlZCBmb3Jcbi8vIHJlZ2lzdGVyVHlwKCkgKGNsZWFudXApLCByZW5hbWluZyBhbmQgbWVyZ2luZy4gTWF0Y2hpbmcgaXMgZXhhY3Qgb24gdGhlIGtleSxcbi8vIHNvIGEgbGlzdCBpcyByZXBsYWNlZCBhcyBhIHdob2xlLiBBIGRpZmZlcmVudGx5IHNwZWxsZWQgcHJvcGVydHkgKFwidHlwXCIpXG4vLyBiZWNvbWVzIFwiVFlQXCIuXG5hc3luYyBmdW5jdGlvbiByZW5hbWVUeXBJbk5vdGVzKHBsdWdpbiwgb2xkS2V5LCBuZXdWYWx1ZSkge1xuICBsZXQgY2hhbmdlZCA9IDA7XG4gIGZvciAoY29uc3QgZmlsZSBvZiBwbHVnaW4udHlwSW5kZXguZmlsZXNXaXRoVHlwKG9sZEtleSkpIHtcbiAgICBsZXQgbWF0Y2hlZCA9IGZhbHNlO1xuICAgIGF3YWl0IHBsdWdpbi5hcHAuZmlsZU1hbmFnZXIucHJvY2Vzc0Zyb250TWF0dGVyKGZpbGUsIChmcm9udG1hdHRlcikgPT4ge1xuICAgICAgaWYgKHR5cEtleU9mKHByb3BlcnR5VmFsdWUoZnJvbnRtYXR0ZXIsIFRZUF9QUk9QRVJUWSkpICE9PSBvbGRLZXkpIHJldHVybjtcbiAgICAgIHNldENhbm9uaWNhbFByb3BlcnR5KGZyb250bWF0dGVyLCBUWVBfUFJPUEVSVFksIG5ld1ZhbHVlKTtcbiAgICAgIG1hdGNoZWQgPSB0cnVlO1xuICAgIH0pO1xuICAgIGlmIChtYXRjaGVkKSBjaGFuZ2VkKys7XG4gIH1cbiAgcmV0dXJuIGNoYW5nZWQ7XG59XG5cbi8vIENsZWFuZWQgZm9ybSBvZiBhIHJhdyB2YWx1ZSBmb3IgcmVnaXN0ZXJUeXAoKTogYSBzaW5nbGUgdmFsdWUgdHJpbW1lZCBhbmRcbi8vIHVwcGVyY2FzZWQ7IGEgbGlzdCBpcyBkZWxpYmVyYXRlbHkgTk9UIHJlZHVjZWQgdG8gb25lIGl0ZW0gYnV0IGpvaW5lZCBpbnRvXG4vLyBvbmUgdmFsdWUgXCJBLCBCXCIgLSB3aGljaCBhIHJlbmFtZSBjYW4gdGhlbiB0dXJuIGludG8gYW5vdGhlciBUWVAgKHNlZVxuLy8gc3RhcnREZXRhaWxSZW5hbWUvc2hvd01lcmdlQ29uZmlybSkuIG5vcm1hbGl6ZSBzcGVsbHMgdGhlIHNpbmdsZSBuYW1lcyAtXG4vLyBub3JtYWxpemVTdWJ0eXBOYW1lIGZvciBTdWJ0eXBzLlxuZnVuY3Rpb24gbm9ybWFsaXplUmF3VHlwKHJhdywgbm9ybWFsaXplID0gbm9ybWFsaXplVHlwTmFtZSkge1xuICBpZiAoQXJyYXkuaXNBcnJheShyYXcpKSB7XG4gICAgcmV0dXJuIHJhd1xuICAgICAgLm1hcCgodikgPT4gbm9ybWFsaXplKFN0cmluZyh2ID8/IFwiXCIpKSlcbiAgICAgIC5maWx0ZXIoQm9vbGVhbilcbiAgICAgIC5qb2luKFwiLCBcIik7XG4gIH1cbiAgcmV0dXJuIG5vcm1hbGl6ZShTdHJpbmcocmF3KSk7XG59XG5cbi8vIFdoZXJlIHR5cGluZyBoYXBwZW5zIGluIHRoZSBwYW5lOiB0ZXh0IGZpZWxkcywgY29udGVudGVkaXRhYmxlIG5hbWVzIGFuZFxuLy8gT2JzaWRpYW4ncyBwcm9wZXJ0eSBlZGl0b3IgKGl0cyByb3dzIHRoZW1zZWx2ZXMgYXJlIGZvY3VzIHN0b3BzIG9mIGl0c1xuLy8ga2V5Ym9hcmQgbmF2aWdhdGlvbiAtIFRhYiBmcm9tIGEgdmFsdWUgbGFuZHMgb24gdGhlIG5leHQgcm93KS4gVGhlIG5hdGl2ZVxuLy8gY29sb3IgcGlja2VyIGRvZXNuJ3QgY291bnQ6IGl0IGtlZXBzIHRoZSBmb2N1cyBhZnRlciBjbG9zaW5nLCB3aGljaCB3b3VsZFxuLy8gaG9sZCBiYWNrIGV2ZXJ5IHJlZnJlc2gsIGFuZCBhIHJlZnJlc2ggd2hpbGUgaXQgaXMgb3BlbiBvbmx5IGNsb3NlcyBpdC5cbmNvbnN0IEZJRUxEX1NFTEVDVE9SID0gJ2lucHV0LCB0ZXh0YXJlYSwgW2NvbnRlbnRlZGl0YWJsZT1cInRydWVcIl0sIFtjb250ZW50ZWRpdGFibGU9XCJcIl0sIC5tZXRhZGF0YS1wcm9wZXJ0eSc7XG5jb25zdCBpc0ZpZWxkID0gKGVsKSA9PiAhIWVsPy5tYXRjaGVzPy4oRklFTERfU0VMRUNUT1IpICYmICFlbC5tYXRjaGVzKCdpbnB1dFt0eXBlPVwiY29sb3JcIl0nKTtcblxuLy8gU2hvd3MgYW4gdW5yZWdpc3RlcmVkIGtleTogcGFkZGluZyB3b3VsZCBiZSBpbnZpc2libGUgYXMgcGxhaW4gdGV4dCwgc28gaXRcbi8vIGdldHMgcXVvdGVzLiBMaXN0cyBhbHJlYWR5IGNhcnJ5IHRoZWlyIGJyYWNrZXRzIGluIHRoZSBrZXkuXG5mdW5jdGlvbiBkaXNwbGF5VHlwS2V5KHR5cEtleSkge1xuICByZXR1cm4gdHlwS2V5ICE9PSB0eXBLZXkudHJpbSgpID8gYFwiJHt0eXBLZXl9XCJgIDogdHlwS2V5O1xufVxuXG5jbGFzcyBUeXBQYW5lIGV4dGVuZHMgSXRlbVZpZXcge1xuICBjb25zdHJ1Y3RvcihsZWFmLCBwbHVnaW4pIHtcbiAgICBzdXBlcihsZWFmKTtcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgfVxuXG4gIGdldFZpZXdUeXBlKCkge1xuICAgIHJldHVybiBWSUVXX1RZUEVfVFlQX1BBTkU7XG4gIH1cblxuICBnZXREaXNwbGF5VGV4dCgpIHtcbiAgICByZXR1cm4gXCJUWVBcIjtcbiAgfVxuXG4gIGdldEljb24oKSB7XG4gICAgcmV0dXJuIFwic2hhcGVzXCI7XG4gIH1cblxuICBhc3luYyBvbk9wZW4oKSB7XG4gICAgdGhpcy5pc0VkaXRpbmcgPSBmYWxzZTtcbiAgICB0aGlzLnNlbGVjdGVkVHlwID0gbnVsbDtcbiAgICB0aGlzLmZyb250bWF0dGVyQmxvY2tzID0gbnVsbDtcbiAgICB0aGlzLmZyb250bWF0dGVyRWRpdG9ycyA9IFtdO1xuXG4gICAgdGhpcy5jb250ZW50RWwuZW1wdHkoKTtcbiAgICB0aGlzLmNvbnRlbnRFbC5hZGRDbGFzcyhcInR5cC1zeXN0ZW0tcGFuZVwiKTtcblxuICAgIC8vIEEgcmVmcmVzaCBmcm9tIG91dHNpZGUgdGhhdCB3YWl0ZWQgZm9yIGEgZmllbGQgKHNlZSByZXF1ZXN0UmVuZGVyKSBydW5zXG4gICAgLy8gb25jZSB0aGUgZm9jdXMgaGFzIGxlZnQgdGhlIGZpZWxkcyBvZiB0aGlzIHBhbmUgLSBjaGVja2VkIGEgdGljayBsYXRlcixcbiAgICAvLyB3aGVuIHRoZSBmb2N1cyBoYXMgc2V0dGxlZC4gTW92aW5nIGZyb20gZmllbGQgdG8gZmllbGQgKFRhYikga2VlcHNcbiAgICAvLyB3YWl0aW5nLlxuICAgIHRoaXMucmVnaXN0ZXJEb21FdmVudCh0aGlzLmNvbnRlbnRFbCwgXCJmb2N1c291dFwiLCAoZXZlbnQpID0+IHtcbiAgICAgIGlmICghdGhpcy5fcmVuZGVyUGVuZGluZyB8fCBpc0ZpZWxkKGV2ZW50LnJlbGF0ZWRUYXJnZXQpKSByZXR1cm47XG4gICAgICB3aW5kb3cuc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIGlmICh0aGlzLl9yZW5kZXJQZW5kaW5nICYmICF0aGlzLmhhc0ZpZWxkRm9jdXMoKSkgdGhpcy5yZW5kZXIoKTtcbiAgICAgIH0sIDApO1xuICAgIH0pO1xuXG4gICAgdGhpcy5yZWdpc3RlckRvbUV2ZW50KHRoaXMuY29udGVudEVsLCBcImtleWRvd25cIiwgKGV2ZW50KSA9PiB7XG4gICAgICBpZiAoZXZlbnQua2V5ID09PSBcIkVzY2FwZVwiICYmIHRoaXMuc2VsZWN0ZWRUeXAgIT09IG51bGwpIHRoaXMuY2xvc2VUeXBTZXR0aW5ncygpO1xuICAgIH0pO1xuICAgIHRoaXMucmVuZGVyKCk7XG4gIH1cblxuICBhc3luYyBvbkNsb3NlKCkge1xuICAgIHRoaXMuY2xvc2VTdWJ0eXBDb2xvclBvcG92ZXI/LigpO1xuICB9XG5cbiAgb3BlblNlYXJjaCh0eXApIHtcbiAgICBjb25zdCBnbG9iYWxTZWFyY2ggPSB0aGlzLnBsdWdpbi5hcHAuaW50ZXJuYWxQbHVnaW5zLmdldFBsdWdpbkJ5SWQoXCJnbG9iYWwtc2VhcmNoXCIpO1xuICAgIGlmICghZ2xvYmFsU2VhcmNoKSByZXR1cm47XG4gICAgLy8gXCJObyBUWVBcIiB3aXRob3V0IGEgZmlsdGVyIHdvdWxkIGFsc28gbWF0Y2ggZXZlcnkgbm9uLW1hcmtkb3duIGZpbGUsXG4gICAgLy8gd2hpY2ggY2FuJ3QgaGF2ZSBmcm9udG1hdHRlciAtIGhlbmNlIGZpbGU6Lm1kLlxuICAgIGNvbnN0IHF1ZXJ5ID0gdHlwID09PSBudWxsID8gYC1bXCIke1RZUF9QUk9QRVJUWX1cIl0gZmlsZToubWRgIDogdGhpcy50eXBDbGF1c2UodHlwKTtcbiAgICBnbG9iYWxTZWFyY2guaW5zdGFuY2Uub3Blbkdsb2JhbFNlYXJjaChxdWVyeSk7XG4gIH1cblxuICAvLyBTZWFyY2ggY2xhdXNlIGZvciBhIFRZUCBrZXkuIEEgbGlzdCAodW5yZWdpc3RlcmVkIGtleSBcIltBLCBCXVwiKSBoYXMgbm9cbiAgLy8gZXhhY3Qgc3ludGF4LCBzbyBpdCBzZWFyY2hlcyBub3RlcyBjYXJyeWluZyBhbGwgaXRzIGl0ZW1zLiBBbHNvIHVzZWQgYnlcbiAgLy8gb3BlblN1YnR5cFNlYXJjaCgpLCB3aGljaCBjYW4gcmVjZWl2ZSBhbiB1bnJlZ2lzdGVyZWQgKHVuY2xlYW4pIFRZUCBrZXkuXG4gIHR5cENsYXVzZSh0eXApIHtcbiAgICBjb25zdCByYXcgPSB0aGlzLnBsdWdpbi50eXBJbmRleC5yYXdWYWx1ZU9mKHR5cCk7XG4gICAgcmV0dXJuIEFycmF5LmlzQXJyYXkocmF3KVxuICAgICAgPyByYXcubWFwKCh2KSA9PiBgW1wiJHtUWVBfUFJPUEVSVFl9XCI6XCIke1N0cmluZyh2ID8/IFwiXCIpLnRyaW0oKX1cIl1gKS5qb2luKFwiIFwiKVxuICAgICAgOiBgW1wiJHtUWVBfUFJPUEVSVFl9XCI6XCIke3R5cH1cIl1gO1xuICB9XG5cbiAgLy8gdHlwS2V5IGNvbWVzIHN0cmFpZ2h0IGZyb20gZnJvbnRtYXR0ZXIgdmFsdWVzIChzZWUgdW5yZWdpc3RlcmVkUm93cyBpblxuICAvLyByZW5kZXIoKSBhbmQgdHlwS2V5T2YpIC0gcG9zc2libHkgbG93ZXJjYXNlLCBwYWRkZWQgb3IgYSBsaXN0LiBUWVAgZW50cmllc1xuICAvLyBhcmUgYWx3YXlzIGNsZWFuIHVwcGVyY2FzZSB2YWx1ZXMsIHNvIHRoZSBjbGVhbmVkIGZvcm0gaXMgcmVnaXN0ZXJlZCAoc2VlXG4gIC8vIG5vcm1hbGl6ZVJhd1R5cCkgYW5kIHRoZSBhZmZlY3RlZCBub3RlcyBhcmUgcmV3cml0dGVuIHJpZ2h0IGF3YXksIHNvIHRoZXlcbiAgLy8gbm8gbG9uZ2VyIHNob3cgdXAgYXMgdW5yZWdpc3RlcmVkLlxuICBhc3luYyByZWdpc3RlclR5cCh0eXBLZXkpIHtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmFwcGx5VHlwUmVnaXN0cmF0aW9uKHR5cEtleSk7XG4gICAgaWYgKCFyZXN1bHQpIHJldHVybjtcblxuICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgIHRoaXMucmVuZGVyKCk7XG4gICAgdGhpcy5yZWZyZXNoT3RoZXJWaWV3cygpO1xuXG4gICAgaWYgKHJlc3VsdC5yZW5hbWVkID4gMCkge1xuICAgICAgbmV3IE5vdGljZShgVFlQICR7cmVzdWx0LnR5cH0gcmVnaXN0ZXJlZCwgJHtwbHVyYWwocmVzdWx0LnJlbmFtZWQsIFwibm90ZVwiKX0gdXBkYXRlZC5gKTtcbiAgICB9XG4gIH1cblxuICAvLyBUaGUgY29yZSBvZiByZWdpc3RlclR5cCgpIHdpdGhvdXQgc2F2aW5nLCByZS1yZW5kZXJpbmcgYW5kIG5vdGljZSwgc29cbiAgLy8gcmVnaXN0ZXJUeXBXaXRoU3VidHlwKCkgY2FuIHJlZ2lzdGVyIFRZUCBhbmQgU3VidHlwIGluIHR1cm4gYW5kIHRoZW4gc2F2ZVxuICAvLyBhbmQgbm90aWZ5IE9OQ0UuIFJldHVybnMgeyB0eXAsIHJlbmFtZWQgfSwgb3IgbnVsbCBpZiBub3RoaW5nIHVzYWJsZSBpc1xuICAvLyBsZWZ0LlxuICBhc3luYyBhcHBseVR5cFJlZ2lzdHJhdGlvbih0eXBLZXkpIHtcbiAgICBjb25zdCByYXcgPSB0aGlzLnBsdWdpbi50eXBJbmRleC5yYXdWYWx1ZU9mKHR5cEtleSk7XG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IG5vcm1hbGl6ZVJhd1R5cChyYXcgPT09IHVuZGVmaW5lZCA/IHR5cEtleSA6IHJhdyk7XG4gICAgaWYgKCFub3JtYWxpemVkKSByZXR1cm4gbnVsbDtcbiAgICBpZiAoIXRoaXMucGx1Z2luLnNldHRpbmdzLnR5cHMuaW5jbHVkZXMobm9ybWFsaXplZCkpIHtcbiAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cHMucHVzaChub3JtYWxpemVkKTtcbiAgICB9XG4gICAgY29uc3QgcmVuYW1lZCA9IG5vcm1hbGl6ZWQgIT09IHR5cEtleSA/IGF3YWl0IHJlbmFtZVR5cEluTm90ZXModGhpcy5wbHVnaW4sIHR5cEtleSwgbm9ybWFsaXplZCkgOiAwO1xuICAgIHJldHVybiB7IHR5cDogbm9ybWFsaXplZCwgcmVuYW1lZCB9O1xuICB9XG5cbiAgLy8gQ29sb3JzIGFuZCBtYXJrcyBvZiBldmVyeSBvdGhlciB2aWV3IGFmdGVyIGEgY2hhbmdlIG1hZGUgaW4gdGhpcyBwYW5lXG4gIC8vIChzZWUgcmVmcmVzaFR5cENvbG9yc0V4Y2VwdCBpbiBtYWluLmpzKS4gVGhpcyBwYW5lIHVwZGF0ZXMgaXRzZWxmOiBlaXRoZXJcbiAgLy8gdGhlIGNoYW5nZSBpcyBhbHJlYWR5IHZpc2libGUgKGEgcHJvcGVydHkgZWRpdCkgb3IgdGhlIGNhbGxlciByZW5kZXJzLlxuICByZWZyZXNoT3RoZXJWaWV3cygpIHtcbiAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzRXhjZXB0Py4odGhpcyk7XG4gIH1cblxuICAvLyBBIG5ldywgZW1wdHkgdHJlZSBpdGVtIHN0cmFpZ2h0IGluIGVkaXQgbW9kZSAtIGxpa2UgT2JzaWRpYW4ncyBvd24gdmlld3NcbiAgLy8gKGEgbmV3IGJvb2ttYXJrIGdyb3VwLCBzYXkpLlxuICBzdGFydEFkZCgpIHtcbiAgICBpZiAodGhpcy5pc0VkaXRpbmcpIHJldHVybjtcblxuICAgIGNvbnN0IHRyZWVJdGVtID0gdGhpcy5saXN0RWwuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbVwiIH0pO1xuICAgIGlmICh0aGlzLnNlcGFyYXRvckVsKSB0aGlzLmxpc3RFbC5pbnNlcnRCZWZvcmUodHJlZUl0ZW0sIHRoaXMuc2VwYXJhdG9yRWwpO1xuICAgIGNvbnN0IHNlbGYgPSB0cmVlSXRlbS5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtLXNlbGYgaXMtY2xpY2thYmxlXCIgfSk7XG4gICAgY29uc3QgaW5uZXIgPSBzZWxmLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW0taW5uZXJcIiB9KTtcblxuICAgIHRoaXMuc3RhcnRJbmxpbmVFZGl0KGlubmVyLCB7XG4gICAgICBjbGFzc0VsOiBzZWxmLFxuICAgICAgb25GaW5pc2g6IGFzeW5jIChjb21taXQsIHRleHQpID0+IHtcbiAgICAgICAgY29uc3QgdmFsdWUgPSBub3JtYWxpemVUeXBOYW1lKHRleHQpO1xuICAgICAgICBpZiAoY29tbWl0ICYmIHZhbHVlKSB7XG4gICAgICAgICAgLy8gTGlrZSBhIFN1YnR5cCB0aGF0IGFscmVhZHkgZXhpc3RzIChzZWUgc3RhcnRBZGRTdWJ0eXApOiBzYXkgc29cbiAgICAgICAgICAvLyBpbnN0ZWFkIG9mIGxldHRpbmcgdGhlIGlucHV0IHZhbmlzaCB3aXRob3V0IGEgd29yZC5cbiAgICAgICAgICBjb25zdCBleGlzdGluZyA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cHMuZmluZCgodCkgPT4gdC50b0xvd2VyQ2FzZSgpID09PSB2YWx1ZS50b0xvd2VyQ2FzZSgpKTtcbiAgICAgICAgICBpZiAoZXhpc3RpbmcpIHtcbiAgICAgICAgICAgIG5ldyBOb3RpY2UoYFRZUCAke2V4aXN0aW5nfSBhbHJlYWR5IGV4aXN0cy5gKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwcy5wdXNoKHZhbHVlKTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgdGhpcy5yZWZyZXNoT3RoZXJWaWV3cygpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICB0aGlzLnJlbmRlcigpO1xuICAgICAgfSxcbiAgICB9KTtcbiAgfVxuXG4gIC8vIEV2ZXJ5IGlubGluZSBpbnB1dCBvZiB0aGUgcGFuZSAtIGEgbmV3IFRZUCBvciBTdWJ0eXAsIHJlbmFtaW5nIG9uZSBpbiB0aGVcbiAgLy8gbGlzdCwgdGhlIGRldGFpbCB0aXRsZSBvciBhIGJsb2NrIGhlYWRpbmcgLSB3b3JrcyB0aGUgc2FtZSB3YXksIGxpa2VcbiAgLy8gT2JzaWRpYW4ncyB0cmVlIGl0ZW1zOiBubyBleHRyYSBpbnB1dCwgdGhlIHRleHQgZWxlbWVudCBpdHNlbGYgYmVjb21lc1xuICAvLyBjb250ZW50ZWRpdGFibGUuIEVudGVyIGNvbW1pdHMsIEVzY2FwZSBjYW5jZWxzLCBsZWF2aW5nIHRoZSBmaWVsZCAoYmx1cilcbiAgLy8gY29tbWl0cyB0b28uIG9uRmluaXNoKGNvbW1pdCwgdGV4dCkgZG9lcyB0aGUgcmVzdDsgaXQgc2hvdWxkIGVuZCBpblxuICAvLyByZW5kZXIoKSBvciBhIGRpYWxvZyB3aG9zZSBjYWxsYmFja3MgcmVuZGVyLlxuICAvL1xuICAvLyAgIGNsYXNzRWwgICAgIC0gZ2V0cyB0aGUgY2xhc3NlcyAodGhlIHdob2xlIHJvdyBpbiB0aGUgbGlzdClcbiAgLy8gICBjbGFzc2VzICAgICAtIG1hcmtzIHRoZSBpbnB1dCBzdGF0ZSAoc3R5bGVzLmNzcywgbWFrZVNlYXJjaGFibGUpXG4gIC8vICAgc3RvcEFsbEtleXMgLSBrZWVwcyBldmVyeSBrZXkgZnJvbSB0aGUgc3Vycm91bmRpbmdzLCBub3Qgb25seSBFbnRlciBhbmRcbiAgLy8gICAgICAgICAgICAgICAgIEVzY2FwZSAoYSBibG9jayBoZWFkaW5nIGluc2lkZSB0aGUgcHJvcGVydHkgZWRpdG9ycyxcbiAgLy8gICAgICAgICAgICAgICAgIHdob3NlIGtleWJvYXJkIG5hdmlnYXRpb24gd291bGQgcmVhY3QgdG9vKVxuICAvL1xuICAvLyBXaGlsZSB0aGUgaW5wdXQgcnVucywgcmVuZGVyKCkgaXMgZGVmZXJyZWQgKHNlZSB0aGVyZSkgLSBhIHJlYnVpbGQgd291bGRcbiAgLy8gcmVtb3ZlIHRoZSBlbGVtZW50LCBhbmQgdGhlIGJsdXIgdGhhdCBmb2xsb3dzIHdvdWxkIGNvbW1pdCBhIGhhbGYtdHlwZWQgb3JcbiAgLy8gZW1wdHkgbmFtZS5cbiAgc3RhcnRJbmxpbmVFZGl0KGVsLCB7IGNsYXNzRWwgPSBlbCwgY2xhc3NlcyA9IFtcImlzLWJlaW5nLXJlbmFtZWRcIl0sIHN0b3BBbGxLZXlzID0gZmFsc2UsIG9uRmluaXNoIH0pIHtcbiAgICBpZiAodGhpcy5pc0VkaXRpbmcpIHJldHVybiBmYWxzZTtcbiAgICB0aGlzLmlzRWRpdGluZyA9IHRydWU7XG5cbiAgICBpZiAoY2xhc3Nlcy5sZW5ndGggPiAwKSBjbGFzc0VsLmFkZENsYXNzKC4uLmNsYXNzZXMpO1xuICAgIGVsLnNldEF0dHJpYnV0ZShcImNvbnRlbnRlZGl0YWJsZVwiLCBcInRydWVcIik7XG4gICAgZWwuc2V0QXR0cmlidXRlKFwic3BlbGxjaGVja1wiLCBcImZhbHNlXCIpO1xuICAgIGVsLmZvY3VzKCk7XG5cbiAgICBjb25zdCByYW5nZSA9IGVsLmRvYy5jcmVhdGVSYW5nZSgpO1xuICAgIHJhbmdlLnNlbGVjdE5vZGVDb250ZW50cyhlbCk7XG4gICAgY29uc3Qgc2VsZWN0aW9uID0gZWwud2luLmdldFNlbGVjdGlvbigpO1xuICAgIHNlbGVjdGlvbi5yZW1vdmVBbGxSYW5nZXMoKTtcbiAgICBzZWxlY3Rpb24uYWRkUmFuZ2UocmFuZ2UpO1xuXG4gICAgbGV0IGRvbmUgPSBmYWxzZTtcbiAgICBjb25zdCBmaW5pc2ggPSBhc3luYyAoY29tbWl0KSA9PiB7XG4gICAgICBpZiAoZG9uZSkgcmV0dXJuO1xuICAgICAgZG9uZSA9IHRydWU7XG4gICAgICB0aGlzLmlzRWRpdGluZyA9IGZhbHNlO1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgb25GaW5pc2goY29tbWl0LCBlbC50ZXh0Q29udGVudCA/PyBcIlwiKTtcbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIC8vIEEgcmVuZGVyIHJlcXVlc3RlZCBkdXJpbmcgdGhlIGlucHV0IHdhcyBvbmx5IGRlZmVycmVkLiBvbkZpbmlzaFxuICAgICAgICAvLyB1c3VhbGx5IHJlbmRlcmVkIGFscmVhZHkgKHdoaWNoIGNsZWFycyB0aGUgZmxhZyk7IGlmIGl0IGxlZnQgdGhlXG4gICAgICAgIC8vIHZpZXcgdG8gYSBkaWFsb2csIGNhdGNoIHVwIG5vdy5cbiAgICAgICAgaWYgKHRoaXMuX3JlbmRlclBlbmRpbmcpIHRoaXMucmVuZGVyKCk7XG4gICAgICB9XG4gICAgfTtcblxuICAgIGVsLmFkZEV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIChldmVudCkgPT4ge1xuICAgICAgaWYgKHN0b3BBbGxLZXlzKSBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIGlmIChldmVudC5rZXkgPT09IFwiRW50ZXJcIikge1xuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgICAgZmluaXNoKHRydWUpO1xuICAgICAgfSBlbHNlIGlmIChldmVudC5rZXkgPT09IFwiRXNjYXBlXCIpIHtcbiAgICAgICAgLy8gc3RvcFByb3BhZ2F0aW9uLCBvciB0aGUgZGV0YWlsIHZpZXcncyBvd24gRXNjYXBlIGhhbmRsZXIgKHNlZVxuICAgICAgICAvLyBvbk9wZW4pIHdvdWxkIGxlYXZlIGl0IGFzIHdlbGwuXG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgICBmaW5pc2goZmFsc2UpO1xuICAgICAgfVxuICAgIH0pO1xuICAgIC8vIEEgYmx1ciBiZWNhdXNlIHRoZSBlbGVtZW50IGxlZnQgdGhlIERPTSAodGhlIHZpZXcgY2xvc2VkLCBzYXkpIGlzIG5vXG4gICAgLy8gZGVjaXNpb24gb2YgdGhlIHVzZXIncyBhbmQgbXVzdCBub3QgY29tbWl0LiBDaGVja2VkIGEgbWljcm90YXNrIGxhdGVyOlxuICAgIC8vIHdoaWxlIGl0IGlzIGJlaW5nIHJlbW92ZWQsIHRoZSBlbGVtZW50IG1heSBzdGlsbCBjb3VudCBhcyBjb25uZWN0ZWQuXG4gICAgZWwuYWRkRXZlbnRMaXN0ZW5lcihcImJsdXJcIiwgKCkgPT4gcXVldWVNaWNyb3Rhc2soKCkgPT4gZmluaXNoKGVsLmlzQ29ubmVjdGVkKSkpO1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgLy8gU3dpdGNoaW5nIGJldHdlZW4gbGlzdCBhbmQgZGV0YWlsIHZpZXcgc3RhcnRzIGF0IHRoZSB0b3A7IGV2ZXJ5IG90aGVyXG4gIC8vIHJlbmRlcigpIGtlZXBzIHRoZSBzY3JvbGwgcG9zaXRpb24gKHNlZSB0aGVyZSkuXG4gIG9wZW5UeXBTZXR0aW5ncyh0eXApIHtcbiAgICB0aGlzLnNlbGVjdGVkVHlwID0gdHlwO1xuICAgIHRoaXMuX3Jlc2V0U2Nyb2xsID0gdHJ1ZTtcbiAgICB0aGlzLnJlbmRlcigpO1xuICB9XG5cbiAgY2xvc2VUeXBTZXR0aW5ncygpIHtcbiAgICB0aGlzLnNlbGVjdGVkVHlwID0gbnVsbDtcbiAgICB0aGlzLl9yZXNldFNjcm9sbCA9IHRydWU7XG4gICAgdGhpcy5yZW5kZXIoKTtcbiAgfVxuXG4gIC8vIFRoZSBlZGl0b3JzIGFyZSBjb21wb25lbnQgY2hpbGRyZW4gKHNlZSBtb3VudEZyb250bWF0dGVyRWRpdG9yKSBhbmQgbXVzdFxuICAvLyBiZSB1bmxvYWRlZCBiZWZvcmUgZXZlcnkgcmVidWlsZCAtIGNvbnRlbnRFbC5lbXB0eSgpIGFsb25lIHdvdWxkIHJlbW92ZSB0aGVcbiAgLy8gRE9NIGJ1dCBsZWF2ZSBlYWNoIGVkaXRvcidzIG1ldGFkYXRhVHlwZU1hbmFnZXIgbGlzdGVuZXIgYmVoaW5kLlxuICAvLyBmcm9udG1hdHRlckJsb2NrcyBjb250cm9scyBhbGwgYmxvY2tzICh1c2VkIGJ5IFwiQWRkIFRZUC1Gcm9udG1hdHRlclxuICAvLyBwcm9wZXJ0eVwiKSwgZnJvbnRtYXR0ZXJFZGl0b3JzIGhvbGRzIGV2ZXJ5IGVkaXRvciBpbmNsLiBTdWJ0eXAgYmxvY2tzLlxuICBkZXN0cm95RnJvbnRtYXR0ZXJFZGl0b3IoKSB7XG4gICAgZm9yIChjb25zdCBlZGl0b3Igb2YgdGhpcy5mcm9udG1hdHRlckVkaXRvcnMgPz8gW10pIHRoaXMucmVtb3ZlQ2hpbGQoZWRpdG9yKTtcbiAgICB0aGlzLmZyb250bWF0dGVyRWRpdG9ycyA9IFtdO1xuICAgIHRoaXMuZnJvbnRtYXR0ZXJCbG9ja3MgPSBudWxsO1xuICB9XG5cbiAgLy8gVGhlIGxpc3Qgb2YgVGVtcGxhdGVyIHNjcmlwdHMgY2hhbmdlZCAoc2VlIHJlZ2lzdGVyVHlwUGFuZSk6IG9ubHkgdGhlXG4gIC8vIHNob3J0Y3V0IGJ1dHRvbnMgb2YgdGhlIG9wZW4gZWRpdG9ycyBmb2xsb3cgLSB0aGVpciBcInNjcmlwdCBub3QgZm91bmRcIlxuICAvLyB3YXJuaW5nIGRlcGVuZHMgb24gaXQuIE5vIHJlbmRlcigpOiBub3RoaW5nIGVsc2UgY2hhbmdlZCwgYW5kIGEgcmVidWlsZFxuICAvLyB3b3VsZCBjb3N0IHRoZSBmb2N1cyBvZiBhIGZpZWxkIGJlaW5nIHR5cGVkIGluLlxuICByZWZyZXNoU2hvcnRjdXRDb250cm9scygpIHtcbiAgICBmb3IgKGNvbnN0IGVkaXRvciBvZiB0aGlzLmZyb250bWF0dGVyRWRpdG9ycyA/PyBbXSkge1xuICAgICAgY29uc3Qgc3RvcmUgPSBlZGl0b3Iub3duZXI/LnR5cFN0b3JlO1xuICAgICAgaWYgKHN0b3JlKSByZW5kZXJTaG9ydGN1dENvbnRyb2xzKHRoaXMsIGVkaXRvciwgc3RvcmUpO1xuICAgIH1cbiAgfVxuXG4gIC8vIEZvY3VzIGluIG9uZSBvZiB0aGUgcGFuZSdzIGZpZWxkcyAoc2VlIGlzRmllbGQpLlxuICBoYXNGaWVsZEZvY3VzKCkge1xuICAgIGNvbnN0IGFjdGl2ZSA9IHRoaXMuY29udGVudEVsLmRvYy5hY3RpdmVFbGVtZW50O1xuICAgIHJldHVybiAhIWFjdGl2ZSAmJiB0aGlzLmNvbnRlbnRFbC5jb250YWlucyhhY3RpdmUpICYmIGlzRmllbGQoYWN0aXZlKTtcbiAgfVxuXG4gIC8vIEEgcmVidWlsZCByZXF1ZXN0ZWQgZnJvbSBvdXRzaWRlIChyZWdpc3RlclR5cFBhbmU6IHJlZnJlc2hUeXBDb2xvcnMoKSwgYW5cbiAgLy8gaW5kZXggY2hhbmdlLCBTeW5jLCBVbmRvKS4gV2hpbGUgc29tZW9uZSB0eXBlcyBpbiB0aGlzIHBhbmUgLSBhXG4gIC8vIGRlc2NyaXB0aW9uLCBhIHByb3BlcnR5LCBhbiBpbmxpbmUgbmFtZSAtIGl0IHdvdWxkIHRocm93IHRoZSBmaWVsZCBhd2F5XG4gIC8vIHdpdGggdGV4dCwgY3Vyc29yIGFuZCBmb2N1cywgc28gaXQgd2FpdHMgdW50aWwgdGhlIGZvY3VzIGxlYXZlcyB0aGVcbiAgLy8gZmllbGRzIChzZWUgb25PcGVuKSBvciB0aGUgaW5saW5lIGlucHV0IGVuZHMgKHNlZSBzdGFydElubGluZUVkaXQpLiBUaGVcbiAgLy8gcGFuZSdzIG93biBhY3Rpb25zIGNhbGwgcmVuZGVyKCkgZGlyZWN0bHkgYW5kIHRha2UgZWZmZWN0IGF0IG9uY2UuXG4gIHJlcXVlc3RSZW5kZXIoKSB7XG4gICAgaWYgKHRoaXMuaGFzRmllbGRGb2N1cygpKSB7XG4gICAgICB0aGlzLl9yZW5kZXJQZW5kaW5nID0gdHJ1ZTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5yZW5kZXIoKTtcbiAgfVxuXG4gIHJlbmRlcigpIHtcbiAgICAvLyBSZWVudHJhbmN5IGd1YXJkOiBhIHJlbmRlciByZWFjaGVkIGZyb20gaW5zaWRlIHJlbmRlcigpIG11c3Qgbm90XG4gICAgLy8gcmVidWlsZCB0aGUgaGFsZi1idWlsdCB2aWV3LiBJdCBvbmNlIHJlY3Vyc2VkIGludG8gYSBzdGFjayBvdmVyZmxvdyBvblxuICAgIC8vIGV2ZXJ5IFRZUCBvcGVuZWQsIHdoZW4gcmVuZGVyVHlwU2V0dGluZ3MoKSBzdGlsbCBlbmRlZCB3aXRoIHRoZSBmdWxsXG4gICAgLy8gcmVmcmVzaFR5cENvbG9ycygpIChpdCBub3cgY2FsbHMgb25seSByZWZyZXNoRnJvbnRtYXR0ZXJIaWdobGlnaHQpLlxuICAgIGlmICh0aGlzLl9yZW5kZXJpbmcpIHJldHVybjtcbiAgICAvLyBBbiBpbmxpbmUgaW5wdXQgaXMgcnVubmluZyAoc2VlIHN0YXJ0SW5saW5lRWRpdCk6IGEgcmVidWlsZCBub3cgd291bGRcbiAgICAvLyB0aHJvdyBpdCBhd2F5IG1pZC10eXBpbmcgLSBhbmQgY29tbWl0IGl0IHRocm91Z2ggdGhlIGJsdXIuIFNvIHRoZSByZW5kZXJcbiAgICAvLyAoYW4gaW5kZXggY2hhbmdlLCBhIHJlZnJlc2ggZnJvbSBlbHNld2hlcmUpIHdhaXRzIGZvciB0aGUgaW5wdXQgdG8gZW5kLlxuICAgIGlmICh0aGlzLmlzRWRpdGluZykge1xuICAgICAgdGhpcy5fcmVuZGVyUGVuZGluZyA9IHRydWU7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMuX3JlbmRlclBlbmRpbmcgPSBmYWxzZTtcbiAgICB0aGlzLl9yZW5kZXJpbmcgPSB0cnVlO1xuICAgIC8vIFRoZSByZWJ1aWxkIGtlZXBzIHRoZSBzY3JvbGwgcG9zaXRpb24sIHNvIGEgbG9uZyBUWVAgZG9lc24ndCBqdW1wIHRvIHRoZVxuICAgIC8vIHRvcCBhZnRlciBldmVyeSBjaGFuZ2U7IG9ubHkgc3dpdGNoaW5nIGJldHdlZW4gbGlzdCBhbmQgZGV0YWlsIHZpZXdcbiAgICAvLyBzdGFydHMgYXQgdGhlIHRvcCAob3BlblR5cFNldHRpbmdzL2Nsb3NlVHlwU2V0dGluZ3MpLlxuICAgIGNvbnN0IHNjcm9sbFRvcCA9IHRoaXMuX3Jlc2V0U2Nyb2xsID8gMCA6IHRoaXMuY29udGVudEVsLnNjcm9sbFRvcDtcbiAgICB0aGlzLl9yZXNldFNjcm9sbCA9IGZhbHNlO1xuICAgIHRyeSB7XG4gICAgICB0aGlzLmRlc3Ryb3lGcm9udG1hdHRlckVkaXRvcigpO1xuICAgICAgaWYgKHRoaXMuc2VsZWN0ZWRUeXAgIT09IG51bGwpIHtcbiAgICAgICAgdGhpcy5yZW5kZXJUeXBTZXR0aW5ncyh0aGlzLnNlbGVjdGVkVHlwKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICAgIGNvbnRlbnRFbC5lbXB0eSgpO1xuXG4gICAgICBjb25zdCB7IGNvdW50cywgbm9UeXAgfSA9IHRoaXMucGx1Z2luLnR5cEluZGV4LnR5cENvdW50cygpO1xuICAgICAgY29uc3QgcmVnaXN0ZXJlZCA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cHM7XG4gICAgICBjb25zdCB0eXBDb2xvcnMgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBDb2xvcnM7XG4gICAgICBjb25zdCBzb3J0T3JkZXIgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBTb3J0T3JkZXIgPz8gREVGQVVMVF9TT1JUX09SREVSO1xuICAgICAgY29uc3QgaXNNYW51YWxTb3J0ID0gc29ydE9yZGVyID09PSBcIm1hbnVhbFwiO1xuICAgICAgY29uc3QgYnlDdXJyZW50T3JkZXIgPSAoYSwgYikgPT4gY29tcGFyZVR5cHMoc29ydE9yZGVyLCBhLCBiLCBjb3VudHMsIHR5cENvbG9ycyk7XG5cbiAgICAgIHRoaXMucmVuZGVyTGlzdEhlYWRlcihjb250ZW50RWwpO1xuXG4gICAgICBjb25zdCB1bnJlZ2lzdGVyZWRSb3dzID0gWy4uLmNvdW50cy5rZXlzKCldXG4gICAgICAgIC5maWx0ZXIoKHR5cCkgPT4gIXJlZ2lzdGVyZWQuaW5jbHVkZXModHlwKSlcbiAgICAgICAgLnNvcnQoYnlDdXJyZW50T3JkZXIpXG4gICAgICAgIC5tYXAoKHR5cCkgPT4gKHsgdHlwLCBjb3VudDogY291bnRzLmdldCh0eXApID8/IDAgfSkpO1xuICAgICAgY29uc3QgdW5yZWdpc3RlcmVkU3VidHlwUm93cyA9IHRoaXMudW5yZWdpc3RlcmVkU3VidHlwUm93cygpO1xuXG4gICAgICAvLyBXaXRob3V0IGEgc2Vjb25kIGNvbHVtbiB0aGUgbmFtZSBtYXkgdGFrZSB0aGUgd2hvbGUgcm93IChzZWVcbiAgICAgIC8vIC50eXAtbGlzdC1uby1zZWNvbmRhcnkgaW4gc3R5bGVzLmNzcykuXG4gICAgICBjb25zdCBsaXN0Q2xzID0gXCJ0eXAtbGlzdCBuYXYtZmlsZXMtY29udGFpbmVyXCIgKyAodGhpcy5zZWNvbmRhcnlNb2RlKCkgPT09IFwibm9uZVwiID8gXCIgdHlwLWxpc3Qtbm8tc2Vjb25kYXJ5XCIgOiBcIlwiKTtcbiAgICAgIHRoaXMubGlzdEVsID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogbGlzdENscyB9KTtcbiAgICAgIHRoaXMuc2VwYXJhdG9yRWwgPSBudWxsO1xuXG4gICAgICAvLyBJbiBtYW51YWwgbW9kZSBzb3J0VHlwc0J5TW9kZSgpIGtlZXBzIHRoZSBvcmRlciBvZiBzZXR0aW5ncy50eXBzLFxuICAgICAgLy8gd2hpY2ggZHJhZyAmIGRyb3AgaW4gcmVuZGVyUmVnaXN0ZXJlZEl0ZW0oKSByZWFycmFuZ2VzOyBpbmRleCBpcyB0aGVcbiAgICAgIC8vIHBvc2l0aW9uIGluIHRoYXQgb3JkZXIuXG4gICAgICBjb25zdCByZWdpc3RlcmVkT3JkZXIgPSBzb3J0VHlwc0J5TW9kZShyZWdpc3RlcmVkLCBzb3J0T3JkZXIsIGNvdW50cywgdHlwQ29sb3JzKTtcbiAgICAgIHJlZ2lzdGVyZWRPcmRlci5mb3JFYWNoKCh0eXAsIGluZGV4KSA9PiB7XG4gICAgICAgIHRoaXMucmVuZGVyUmVnaXN0ZXJlZEl0ZW0odHlwLCBjb3VudHMuZ2V0KHR5cCkgPz8gMCwgeyBkcmFnZ2FibGU6IGlzTWFudWFsU29ydCwgaW5kZXggfSk7XG4gICAgICB9KTtcblxuICAgICAgLy8gQmVsb3cgdGhlIHNlcGFyYXRvciB0aHJlZSBvcHRpb25hbCBzZWN0aW9uczogdW5yZWdpc3RlcmVkIFRZUCB2YWx1ZXMsXG4gICAgICAvLyB1bnJlZ2lzdGVyZWQgU3VidHlwcywgXCJbTk8gVFlQXVwiLiBUaGUgU3VidHlwcyBnZXQgdGhlaXIgb3duIHNlcGFyYXRvclxuICAgICAgLy8gYmVjYXVzZSB0aGV5IHNvcnQgYnkgYSBkaWZmZXJlbnQgcnVsZSAoY291bnQsIG5vdCB0aGUgc29ydCBidXR0b24pIC1cbiAgICAgIC8vIHdpdGhvdXQgYSB2aXNpYmxlIGN1dCBpdCB3b3VsZCBsb29rIGxpa2UgYnJva2VuIHNvcnRpbmcuIFwiW05PIFRZUF1cIiBpc1xuICAgICAgLy8gbm8gcmVhbCBUWVAsIHRha2VzIG5vIHBhcnQgaW4gc29ydGluZyBhbmQgYWx3YXlzIGNvbWVzIGxhc3QsIHdpdGhvdXQgYVxuICAgICAgLy8gdGhpcmQgbGluZS5cbiAgICAgIC8vXG4gICAgICAvLyB0aGlzLnNlcGFyYXRvckVsIHN0YXlzIHRoZSBGSVJTVCBsaW5lOiBzdGFydEFkZCgpIGluc2VydHMgdGhlIG5ldyBpdGVtXG4gICAgICAvLyBiZWZvcmUgaXQsIGFuZCBhIG5ldyBUWVAgYmVsb25ncyBhZnRlciB0aGUgcmVnaXN0ZXJlZCBvbmVzLlxuICAgICAgY29uc3Qgc2VwYXJhdG9yID0gKCkgPT4ge1xuICAgICAgICBjb25zdCBlbCA9IHRoaXMubGlzdEVsLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtc2VwYXJhdG9yXCIgfSk7XG4gICAgICAgIHRoaXMuc2VwYXJhdG9yRWwgPSB0aGlzLnNlcGFyYXRvckVsID8/IGVsO1xuICAgICAgfTtcblxuICAgICAgaWYgKHVucmVnaXN0ZXJlZFJvd3MubGVuZ3RoID4gMCB8fCB1bnJlZ2lzdGVyZWRTdWJ0eXBSb3dzLmxlbmd0aCA+IDAgfHwgbm9UeXAgPiAwKSBzZXBhcmF0b3IoKTtcbiAgICAgIGZvciAoY29uc3Qgcm93IG9mIHVucmVnaXN0ZXJlZFJvd3MpIHRoaXMucmVuZGVyVW5yZWdpc3RlcmVkSXRlbShyb3cudHlwLCByb3cuY291bnQpO1xuXG4gICAgICBpZiAodW5yZWdpc3RlcmVkU3VidHlwUm93cy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGlmICh1bnJlZ2lzdGVyZWRSb3dzLmxlbmd0aCA+IDApIHNlcGFyYXRvcigpO1xuICAgICAgICBmb3IgKGNvbnN0IHJvdyBvZiB1bnJlZ2lzdGVyZWRTdWJ0eXBSb3dzKSB0aGlzLnJlbmRlclVucmVnaXN0ZXJlZFN1YnR5cEl0ZW0ocm93KTtcbiAgICAgIH1cblxuICAgICAgaWYgKG5vVHlwID4gMCkgdGhpcy5yZW5kZXJOb1R5cEl0ZW0obm9UeXApO1xuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLmNvbnRlbnRFbC5zY3JvbGxUb3AgPSBzY3JvbGxUb3A7XG4gICAgICB0aGlzLl9yZW5kZXJpbmcgPSBmYWxzZTtcbiAgICB9XG4gIH1cblxuICAvLyBMaWtlIHRoZSBcIkNoYW5nZSBzb3J0IG9yZGVyXCIgYnV0dG9uIGluIE9ic2lkaWFuJ3MgdGFncyBhbmQgYWxsLXByb3BlcnRpZXNcbiAgLy8gdmlld3MuXG4gIHJlbmRlckxpc3RIZWFkZXIoY29udGVudEVsKSB7XG4gICAgY29uc3QgaGVhZGVyID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJuYXYtaGVhZGVyXCIgfSk7XG4gICAgY29uc3QgYnV0dG9uc0NvbnRhaW5lciA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwibmF2LWJ1dHRvbnMtY29udGFpbmVyXCIgfSk7XG5cbiAgICBjb25zdCBhZGRCdG4gPSBidXR0b25zQ29udGFpbmVyLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwiY2xpY2thYmxlLWljb24gbmF2LWFjdGlvbi1idXR0b25cIixcbiAgICAgIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiQWRkIFRZUFwiIH0sXG4gICAgfSk7XG4gICAgc2V0SWNvbihhZGRCdG4sIFwicGx1c1wiKTtcbiAgICBhZGRCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuc3RhcnRBZGQoKSk7XG5cbiAgICBjb25zdCBzb3J0QnRuID0gYnV0dG9uc0NvbnRhaW5lci5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImNsaWNrYWJsZS1pY29uIG5hdi1hY3Rpb24tYnV0dG9uXCIsXG4gICAgICBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIkNoYW5nZSBzb3J0IG9yZGVyXCIgfSxcbiAgICB9KTtcbiAgICBzZXRJY29uKHNvcnRCdG4sIFwibHVjaWRlLXNvcnQtYXNjXCIpO1xuICAgIHNvcnRCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIChldmVudCkgPT4gdGhpcy5zaG93U29ydE1lbnUoZXZlbnQpKTtcblxuICAgIC8vIFNlY29uZCBjb2x1bW46IGEgYnV0dG9uIGN5Y2xpbmcgdGhlIHRocmVlIG1vZGVzIHJhdGhlciB0aGFuIGEgbWVudSAtXG4gICAgLy8gd2l0aCBzbyBmZXcgc3RhdGVzIHdob3NlIGVmZmVjdCBzaG93cyByaWdodCBiZWxvdywgY2xpY2tpbmcgdGhyb3VnaCBpc1xuICAgIC8vIGZhc3Rlci4gSWNvbiBhbmQgdG9vbHRpcCBzaG93IHRoZSBjdXJyZW50IG1vZGUuXG4gICAgY29uc3QgY3VycmVudCA9IFNFQ09OREFSWV9NT0RFU1t0aGlzLnNlY29uZGFyeUluZGV4KCldO1xuICAgIGNvbnN0IHNlY29uZGFyeUJ0biA9IGJ1dHRvbnNDb250YWluZXIuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJjbGlja2FibGUtaWNvbiBuYXYtYWN0aW9uLWJ1dHRvblwiLFxuICAgICAgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogYE5leHQgdG8gbmFtZTogJHtjdXJyZW50LnRpdGxlfWAgfSxcbiAgICB9KTtcbiAgICBzZXRJY29uKHNlY29uZGFyeUJ0biwgY3VycmVudC5pY29uKTtcbiAgICBzZWNvbmRhcnlCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuY3ljbGVTZWNvbmRhcnkoKSk7XG4gIH1cblxuICAvLyBzZXR0aW5ncy50eXBMaXN0U2Vjb25kYXJ5LCBidXQgYWx3YXlzIGEgdmFsaWQgbW9kZSAtIG9sZGVyIGRhdGEgbWF5IGxhY2tcbiAgLy8gdGhlIGtleSwgYW5kIGEgbW9kZSByZW1vdmVkIGxhdGVyIHNob3VsZG4ndCBsZWF2ZSB0aGUgbGlzdCBlbXB0eS5cbiAgc2Vjb25kYXJ5TW9kZSgpIHtcbiAgICBjb25zdCBtb2RlID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwTGlzdFNlY29uZGFyeTtcbiAgICByZXR1cm4gU0VDT05EQVJZX01PREVTLnNvbWUoKGVudHJ5KSA9PiBlbnRyeS5tb2RlID09PSBtb2RlKSA/IG1vZGUgOiBERUZBVUxUX1NFQ09OREFSWTtcbiAgfVxuXG4gIHNlY29uZGFyeUluZGV4KCkge1xuICAgIHJldHVybiBTRUNPTkRBUllfTU9ERVMuZmluZEluZGV4KChlbnRyeSkgPT4gZW50cnkubW9kZSA9PT0gdGhpcy5zZWNvbmRhcnlNb2RlKCkpO1xuICB9XG5cbiAgYXN5bmMgY3ljbGVTZWNvbmRhcnkoKSB7XG4gICAgY29uc3QgbmV4dCA9IFNFQ09OREFSWV9NT0RFU1sodGhpcy5zZWNvbmRhcnlJbmRleCgpICsgMSkgJSBTRUNPTkRBUllfTU9ERVMubGVuZ3RoXTtcbiAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBMaXN0U2Vjb25kYXJ5ID0gbmV4dC5tb2RlO1xuICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgIC8vIE9ubHkgdGhpcyBsaXN0IGNoYW5nZXMsIHNvIG5vIHJlZnJlc2hUeXBDb2xvcnMoKSBhY3Jvc3MgYWxsIHZpZXdzLlxuICAgIHRoaXMucmVuZGVyKCk7XG4gIH1cblxuICBzaG93U29ydE1lbnUoZXZlbnQpIHtcbiAgICBjb25zdCBjdXJyZW50ID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwU29ydE9yZGVyID8/IERFRkFVTFRfU09SVF9PUkRFUjtcbiAgICBjb25zdCBtZW51ID0gbmV3IE1lbnUoKTtcblxuICAgIGNvbnN0IGFkZEdyb3VwID0gKHN0YXJ0LCBlbmQpID0+IHtcbiAgICAgIGZvciAobGV0IGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgICAgIGNvbnN0IHsgbW9kZSwgdGl0bGUgfSA9IFNPUlRfT1BUSU9OU1tpXTtcbiAgICAgICAgbWVudS5hZGRJdGVtKChpdGVtKSA9PlxuICAgICAgICAgIGl0ZW1cbiAgICAgICAgICAgIC5zZXRUaXRsZSh0aXRsZSlcbiAgICAgICAgICAgIC5zZXRDaGVja2VkKGN1cnJlbnQgPT09IG1vZGUpXG4gICAgICAgICAgICAub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cFNvcnRPcmRlciA9IG1vZGU7XG4gICAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgICB0aGlzLnJlbmRlcigpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICB9O1xuXG4gICAgYWRkR3JvdXAoMCwgMSk7XG4gICAgbWVudS5hZGRTZXBhcmF0b3IoKTtcbiAgICBhZGRHcm91cCgxLCAzKTtcbiAgICBtZW51LmFkZFNlcGFyYXRvcigpO1xuICAgIGFkZEdyb3VwKDMsIDUpO1xuICAgIG1lbnUuYWRkU2VwYXJhdG9yKCk7XG4gICAgYWRkR3JvdXAoNSwgNyk7XG5cbiAgICBtZW51LnNob3dBdE1vdXNlRXZlbnQoZXZlbnQpO1xuICB9XG5cbiAgcmVuZGVyTm9UeXBJdGVtKGNvdW50KSB7XG4gICAgY29uc3QgdHJlZUl0ZW0gPSB0aGlzLmxpc3RFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtXCIgfSk7XG4gICAgY29uc3Qgc2VsZiA9IHRyZWVJdGVtLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW0tc2VsZiBpcy1jbGlja2FibGUgdHlwLXVucmVnaXN0ZXJlZFwiIH0pO1xuICAgIHNlbGYuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1pbm5lclwiLCB0ZXh0OiBcIltOTyBUWVBdXCIgfSk7XG4gICAgdGhpcy5yZW5kZXJDb3VudEZsYWlyKHNlbGYsIGNvdW50KTtcblxuICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMub3BlblNlYXJjaChudWxsKSk7XG4gICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiY29udGV4dG1lbnVcIiwgKGV2ZW50KSA9PiB7XG4gICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICB0aGlzLm9wZW5TZWFyY2gobnVsbCk7XG4gICAgfSk7XG4gIH1cblxuICAvLyBDaHJvbWl1bSdzIGlucHV0W3R5cGU9Y29sb3JdIGhhcyBhIG1pbmltdW0gc3dhdGNoIHRoYXQgd29uJ3Qgc2NhbGUgYmVsb3dcbiAgLy8gdGV4dCBzaXplLCBzbyBpdCBpcyBvbmx5IGFuIGludmlzaWJsZSB0cmlnZ2VyIG92ZXIgYSBmcmVlbHkgc2NhbGFibGUgZG90LlxuICAvLyBXaXRob3V0IGEgY29sb3IgdGhlIGRvdCBpcyBhIGhvbGxvdyBncmF5IHJpbmcgKHNlZSBwYWludENvbG9yRG90KTsgd2l0aFxuICAvLyBzaG93UmVzZXQgKGRldGFpbCB2aWV3KSBhIHRvb2x0aXAgbmFtZXMgdGhlIHN0YXRlIGFuZCB0aGUgcmVzZXQgYnV0dG9uIGlzXG4gIC8vIGdyYXllZCBvdXQuXG4gIHJlbmRlckNvbG9yUGlja2VyKHBhcmVudCwgdHlwLCBvbkNoYW5nZSwgeyBzaG93UmVzZXQgPSBmYWxzZSB9ID0ge30pIHtcbiAgICBjb25zdCBjdXJyZW50Q29sb3IgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBDb2xvcnNbdHlwXSA/PyBERUZBVUxUX1RZUF9DT0xPUjtcbiAgICBjb25zdCBjb2xvcldyYXAgPSBwYXJlbnQuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1jb2xvci13cmFwXCIgfSk7XG4gICAgY29uc3QgY29sb3JEb3QgPSBjb2xvcldyYXAuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1jb2xvci1kb3RcIiB9KTtcbiAgICBsZXQgcmVzZXRCdG4gPSBudWxsO1xuICAgIGNvbnN0IHNob3dTdGF0ZSA9IChjb2xvciwgaXNEZWZhdWx0KSA9PiB7XG4gICAgICBwYWludENvbG9yRG90KGNvbG9yRG90LCBjb2xvciwgaXNEZWZhdWx0KTtcbiAgICAgIGlmICghc2hvd1Jlc2V0KSByZXR1cm47XG4gICAgICBjb2xvcldyYXAuc2V0QXR0cmlidXRlKFwiYXJpYS1sYWJlbFwiLCBpc0RlZmF1bHQgPyBcIkRlZmF1bHQgKG5vIGNvbG9yKVwiIDogXCJDaGFuZ2UgY29sb3JcIik7XG4gICAgICByZXNldEJ0bj8udG9nZ2xlQ2xhc3MoXCJpcy1kaXNhYmxlZFwiLCBpc0RlZmF1bHQpO1xuICAgIH07XG5cbiAgICBjb25zdCBjb2xvcklucHV0ID0gY29sb3JXcmFwLmNyZWF0ZUVsKFwiaW5wdXRcIiwgeyB0eXBlOiBcImNvbG9yXCIsIGNsczogXCJ0eXAtY29sb3ItaW5wdXRcIiB9KTtcbiAgICBjb2xvcklucHV0LnZhbHVlID0gY3VycmVudENvbG9yO1xuXG4gICAgLy8gXCJpbnB1dFwiIGZpcmVzIGZvciBldmVyeSBpbnRlcm1lZGlhdGUgY29sb3Igd2hpbGUgdGhlIG5hdGl2ZSBwaWNrZXIgaXNcbiAgICAvLyBvcGVuIC0gb25seSBhIGxvY2FsIHByZXZpZXcgaGVyZS4gUmVmcmVzaGluZyB0aGUgdmlld3Mgd291bGQgcmUtcmVuZGVyXG4gICAgLy8gdGhpcyBvbmUsIHJlbW92ZSB0aGlzIDxpbnB1dCB0eXBlPWNvbG9yPiBhbmQgY2xvc2UgdGhlIG5hdGl2ZSBwaWNrZXJcbiAgICAvLyBiZWZvcmUgYSBjb2xvciBjb3VsZCBldmVuIGJlIGNob3Nlbi5cbiAgICAvL1xuICAgIC8vIFNhdmluZyBpcyBidW5kbGVkOiBkYXRhLmpzb24gaXMgd3JpdHRlbiBvbmNlIHRoZSBwb2ludGVyIHJlc3RzIGZvciBhXG4gICAgLy8gbW9tZW50IChzYXZlU29vbikgYW5kIGF0IHRoZSBsYXRlc3Qgb24gXCJjaGFuZ2VcIiwgbm90IG9uIGV2ZXJ5XG4gICAgLy8gaW50ZXJtZWRpYXRlIGNvbG9yLlxuICAgIC8vXG4gICAgLy8gT25lIHVuZG8gc25hcHNob3QgcGVyIHBpY2tlciBzZXNzaW9uOiB0YWtlbiBiZWZvcmUgdGhlIGZpcnN0XG4gICAgLy8gaW50ZXJtZWRpYXRlIGNvbG9yLCBvZmZlcmVkIG9uY2UgdGhlIGNob2ljZSBpcyBjb25maXJtZWQgKFwiY2hhbmdlXCIpLlxuICAgIC8vIENsZWFyZWQgd2hlbiB0aGUgcGlja2VyIG9wZW5zLCBzbyBhIHNlc3Npb24gdGhhdCBlbmRlZCB3aXRob3V0IFwiY2hhbmdlXCJcbiAgICAvLyAoYmFjayB0byB0aGUgb2xkIGNvbG9yLCBvciBjYW5jZWxsZWQpIGxlYXZlcyBubyBzdGFsZSBzbmFwc2hvdCBiZWhpbmQuXG4gICAgY29uc3Qgc2F2ZVNvb24gPSBkZWJvdW5jZSgoKSA9PiB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKSwgNDAwLCB0cnVlKTtcbiAgICBsZXQgdW5kb1NuYXBzaG90ID0gbnVsbDtcbiAgICBjb2xvcklucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZXZlbnQpID0+IHtcbiAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgdW5kb1NuYXBzaG90ID0gbnVsbDtcbiAgICB9KTtcbiAgICBjb2xvcklucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJpbnB1dFwiLCAoKSA9PiB7XG4gICAgICB1bmRvU25hcHNob3QgPz89IHNuYXBzaG90U2V0dGluZ3ModGhpcy5wbHVnaW4pO1xuICAgICAgc2hvd1N0YXRlKGNvbG9ySW5wdXQudmFsdWUsIGZhbHNlKTtcbiAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cENvbG9yc1t0eXBdID0gY29sb3JJbnB1dC52YWx1ZTtcbiAgICAgIG9uQ2hhbmdlPy4oY29sb3JJbnB1dC52YWx1ZSk7XG4gICAgICBzYXZlU29vbigpO1xuICAgIH0pO1xuXG4gICAgLy8gT25jZSB0aGUgY2hvaWNlIGlzIGNvbmZpcm1lZCBhbmQgdGhlIHBpY2tlciBjbG9zZWQsIGEgcmUtcmVuZGVyIGNhbid0XG4gICAgLy8gYnJlYWsgYW55dGhpbmcgYW55IG1vcmUuIFRoZSBwZW5kaW5nIHNhdmUgaXMgZG9uZSByaWdodCBoZXJlIGluc3RlYWQgLVxuICAgIC8vIGJlZm9yZSBvZmZlclVuZG8oKSwgd2hpY2ggcmVjb3JkcyB0aGUgc2V0dGluZ3MgcmV2aXNpb24gb2YgdGhpcyBzYXZlXG4gICAgLy8gKGEgbGF0ZXIgZGVib3VuY2VkIHNhdmUgd291bGQgdm9pZCB0aGUgdW5kbyBhdCBvbmNlKS5cbiAgICBjb2xvcklucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjaGFuZ2VcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgc2F2ZVNvb24uY2FuY2VsKCk7XG4gICAgICBjb25zdCBzbmFwc2hvdCA9IHVuZG9TbmFwc2hvdDtcbiAgICAgIHVuZG9TbmFwc2hvdCA9IG51bGw7XG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgIGlmIChzbmFwc2hvdCAmJiBzbmFwc2hvdC50eXBDb2xvcnNbdHlwXSAhPT0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzW3R5cF0pIHtcbiAgICAgICAgb2ZmZXJVbmRvKHRoaXMucGx1Z2luLCBgQ29sb3Igb2YgJHt0eXB9IGNoYW5nZWQuYCwgc25hcHNob3QpO1xuICAgICAgfVxuICAgICAgdGhpcy5yZWZyZXNoT3RoZXJWaWV3cygpO1xuICAgICAgLy8gVGhlIFN1YnR5cCBjb2xvcnMgKGxpc3QgcHJldmlldywgYmxvY2sgZG90cykgZGVyaXZlIGZyb20gdGhpcyBjb2xvci5cbiAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgfSk7XG5cbiAgICBpZiAoc2hvd1Jlc2V0KSB7XG4gICAgICByZXNldEJ0biA9IHBhcmVudC5jcmVhdGVEaXYoe1xuICAgICAgICBjbHM6IFwiY2xpY2thYmxlLWljb24gdHlwLWNvbG9yLXJlc2V0XCIsXG4gICAgICAgIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiUmVzZXQgY29sb3JcIiB9LFxuICAgICAgfSk7XG4gICAgICBzZXRJY29uKHJlc2V0QnRuLCBcInJvdGF0ZS1jY3dcIik7XG4gICAgICByZXNldEJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAvLyBObyB1bmRvIG9mZmVyIGZvciBhIG5vLW9wICh0aGUgYnV0dG9uIGlzIG9ubHkgZ3JheWVkIG91dCkuXG4gICAgICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBDb2xvcnNbdHlwXSA9PT0gdW5kZWZpbmVkKSByZXR1cm47XG4gICAgICAgIGNvbnN0IHNuYXBzaG90ID0gc25hcHNob3RTZXR0aW5ncyh0aGlzLnBsdWdpbik7XG4gICAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBDb2xvcnNbdHlwXTtcbiAgICAgICAgY29sb3JJbnB1dC52YWx1ZSA9IERFRkFVTFRfVFlQX0NPTE9SO1xuICAgICAgICBzaG93U3RhdGUoREVGQVVMVF9UWVBfQ09MT1IsIHRydWUpO1xuICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgb2ZmZXJVbmRvKHRoaXMucGx1Z2luLCBgQ29sb3Igb2YgJHt0eXB9IHJlc2V0LmAsIHNuYXBzaG90KTtcbiAgICAgICAgb25DaGFuZ2U/LihERUZBVUxUX1RZUF9DT0xPUik7XG4gICAgICAgIHRoaXMucmVmcmVzaE90aGVyVmlld3MoKTtcbiAgICAgICAgdGhpcy5yZW5kZXIoKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgICBzaG93U3RhdGUoY3VycmVudENvbG9yLCB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBDb2xvcnNbdHlwXSA9PT0gdW5kZWZpbmVkKTtcblxuICAgIHJldHVybiBjb2xvcldyYXA7XG4gIH1cblxuICAvLyBHdWFyZHMgc2V0dGluZ3Mgb2JqZWN0cyBsb2FkZWQgYmVmb3JlIHR5cE1hbnVhbCBleGlzdGVkIChhIHJ1bm5pbmdcbiAgLy8gc2Vzc2lvbiBhY3Jvc3MgYSBob3QgcmVsb2FkLCBzYXkpIC0gb3RoZXJ3aXNlIGV2ZXJ5IGFjY2VzcyBiZWxvdyB3b3VsZFxuICAvLyB0aHJvdyBhbmQgdGFrZSB0aGUgcmVzdCBvZiByZW5kZXJUeXBTZXR0aW5ncygpIGRvd24gd2l0aCBpdC5cbiAgZW5zdXJlVHlwTWFudWFsKCkge1xuICAgIGlmICghdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwTWFudWFsKSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBNYW51YWwgPSB7fTtcbiAgICByZXR1cm4gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwTWFudWFsO1xuICB9XG5cbiAgLy8gVGhlIHNoYXJlZCBcIk1hbnVhbGx5IGNyZWF0YWJsZVwiIGJ1dHRvbiBvZiBUWVAgKHJlbmRlck1hbnVhbFRvZ2dsZSkgYW5kXG4gIC8vIFN1YnR5cCAocmVuZGVyU3VidHlwTWFudWFsVG9nZ2xlKSwgZWFjaCBiZXR3ZWVuIHJlbmFtZSBhbmQgZGVsZXRlLiBBblxuICAvLyBpY29uIGJ1dHRvbiByYXRoZXIgdGhhbiBhIGxhYmVsZWQgdG9nZ2xlIC0gdG9vIHNtYWxsIGEgc2V0dGluZyBmb3IgaXRzIG93blxuICAvLyByb3cuIFN0YXRlIHZpYSBhIGNsYXNzIChpcy1hY3RpdmUsIHNlZSBzdHlsZXMuY3NzKSwgbWVhbmluZyBpbiB0aGUgdG9vbHRpcDtcbiAgLy8gcm9sZS9hcmlhLWNoZWNrZWQga2VlcCBpdCByZWFkYWJsZSBhcyBhIHN3aXRjaC5cbiAgLy9cbiAgLy8gb25Ub2dnbGUgZ2V0cyB0aGUgbmV3IHN0YXRlLCBzYXZlcyBpdCBhbmQgdXBkYXRlcyB0aGUgZGVwZW5kZW50IGJ1dHRvbnNcbiAgLy8gKHNlZSBzeW5jTWFudWFsVG9nZ2xlcykgLSB0aGUgY2xpY2sgZG9lc24ndCBwYWludCBpdHNlbGYsIHNpbmNlIGEgdG9nZ2xlXG4gIC8vIGhlcmUgbmV2ZXIgYWZmZWN0cyBqdXN0IHRoaXMgb25lIGJ1dHRvbi5cbiAgcmVuZGVyTWFudWFsSWNvbihwYXJlbnQsIGNscywgaXNPbiwgb25Ub2dnbGUpIHtcbiAgICBjb25zdCBidG4gPSBwYXJlbnQuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogYGNsaWNrYWJsZS1pY29uIHR5cC1tYW51YWwtaWNvbiAke2Nsc31gLFxuICAgICAgYXR0cjogeyB0YWJpbmRleDogXCIwXCIsIHJvbGU6IFwiY2hlY2tib3hcIiB9LFxuICAgIH0pO1xuICAgIHNldEljb24oYnRuLCBcImZpbGUtcGVuLWxpbmVcIik7XG5cbiAgICBidG4udHlwU2hvd01hbnVhbFN0YXRlID0gKG9uKSA9PiB7XG4gICAgICBidG4udG9nZ2xlQ2xhc3MoXCJpcy1hY3RpdmVcIiwgb24pO1xuICAgICAgYnRuLnNldEF0dHJpYnV0ZShcImFyaWEtY2hlY2tlZFwiLCBTdHJpbmcob24pKTtcbiAgICAgIGJ0bi5zZXRBdHRyaWJ1dGUoXCJhcmlhLWxhYmVsXCIsIG9uID8gXCJNYW51YWxseSBjcmVhdGFibGVcIiA6IFwiTm90IG1hbnVhbGx5IGNyZWF0YWJsZVwiKTtcbiAgICB9O1xuICAgIGJ0bi50eXBTaG93TWFudWFsU3RhdGUoaXNPbik7XG5cbiAgICBjb25zdCB0b2dnbGUgPSAoKSA9PiBvblRvZ2dsZSghYnRuLmhhc0NsYXNzKFwiaXMtYWN0aXZlXCIpKTtcbiAgICBidG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIHRvZ2dsZSk7XG4gICAgYnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIChldmVudCkgPT4ge1xuICAgICAgaWYgKGV2ZW50LmtleSA9PT0gXCJFbnRlclwiIHx8IGV2ZW50LmtleSA9PT0gXCIgXCIpIHtcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgdG9nZ2xlKCk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICByZXR1cm4gYnRuO1xuICB9XG5cbiAgLy8gVGhlIFRZUCdzIFwiTWFudWFsbHkgY3JlYXRhYmxlXCIsIGluIHRoZSBkZXRhaWwgaGVhZGVyIGJldHdlZW4gcmVuYW1lIGFuZFxuICAvLyBkZWxldGUuIE9uIGJ5IGRlZmF1bHQsIHNvIG9ubHkgXCJvZmZcIiAoZmFsc2UpIGlzIHN0b3JlZC4gRGVjaWRlcyB3aGV0aGVyXG4gIC8vIGdldFR5cHMoKSAobWFpbi5qcykgcmV0dXJucyB0aGUgVFlQLlxuICAvL1xuICAvLyBUaGUgVFlQIGFsd2F5cyB0YWtlcyBpdHMgU3VidHlwcyBhbG9uZzogdGhlIHBpY2tlciBvbmx5IHJlYWNoZXMgdGhlbVxuICAvLyB0aHJvdWdoIGl0LCBzbyBhIFRZUCBzd2l0Y2hlZCBvZmYgd291bGQgc2lsZW50bHkgbWFrZSB0aGVtIHVucmVhY2hhYmxlXG4gIC8vIChzZWUgc2V0QWxsU3VidHlwc01hbnVhbCBpbiBzdWJ0eXBzLmpzKS5cbiAgcmVuZGVyTWFudWFsVG9nZ2xlKHBhcmVudCwgdHlwKSB7XG4gICAgcmV0dXJuIHRoaXMucmVuZGVyTWFudWFsSWNvbihwYXJlbnQsIFwidHlwLW1hbnVhbC10eXBcIiwgdGhpcy5lbnN1cmVUeXBNYW51YWwoKVt0eXBdICE9PSBmYWxzZSwgYXN5bmMgKG9uKSA9PiB7XG4gICAgICBpZiAob24pIGRlbGV0ZSB0aGlzLmVuc3VyZVR5cE1hbnVhbCgpW3R5cF07XG4gICAgICBlbHNlIHRoaXMuZW5zdXJlVHlwTWFudWFsKClbdHlwXSA9IGZhbHNlO1xuICAgICAgc2V0QWxsU3VidHlwc01hbnVhbCh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwLCBvbik7XG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgIHRoaXMuc3luY01hbnVhbFRvZ2dsZXModHlwKTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIEEgU3VidHlwJ3MgXCJNYW51YWxseSBjcmVhdGFibGVcIiwgaW4gaXRzIGJsb2NrIGZvb3RlciBiZXR3ZWVuIHJlbmFtZSBhbmRcbiAgLy8gZGVsZXRlIChzZWUgcmVuZGVyU2VjdGlvbkZvb3RlcikuIFVubGlrZSB0aGUgVFlQIGJ1dHRvbiBpdCBwdWxscyBvbmx5IG9uZVxuICAvLyB3YXk6IHN3aXRjaGluZyBhIFN1YnR5cCBvbiBhbHNvIHN3aXRjaGVzIGl0cyBUWVAgb24gKGVsc2UgaXQgd291bGQgYmVcbiAgLy8gdW5yZWFjaGFibGUpLCB0aGUgb3RoZXIgU3VidHlwcyBzdGF5IGFzIHRoZXkgYXJlIC0gdGhhdCBpcyB0aGUgcG9pbnQuXG4gIHJlbmRlclN1YnR5cE1hbnVhbFRvZ2dsZShwYXJlbnQsIHR5cCwgc3VidHlwKSB7XG4gICAgY29uc3QgYnRuID0gdGhpcy5yZW5kZXJNYW51YWxJY29uKFxuICAgICAgcGFyZW50LFxuICAgICAgXCJ0eXAtbWFudWFsLXN1YnR5cFwiLFxuICAgICAgaXNTdWJ0eXBNYW51YWwodGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCwgc3VidHlwKSxcbiAgICAgIGFzeW5jIChvbikgPT4ge1xuICAgICAgICBzZXRTdWJ0eXBNYW51YWwodGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCwgc3VidHlwLCBvbik7XG4gICAgICAgIGlmIChvbikgZGVsZXRlIHRoaXMuZW5zdXJlVHlwTWFudWFsKClbdHlwXTtcbiAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIHRoaXMuc3luY01hbnVhbFRvZ2dsZXModHlwKTtcbiAgICAgIH1cbiAgICApO1xuICAgIGJ0bi50eXBTdWJ0eXAgPSBzdWJ0eXA7XG4gICAgcmV0dXJuIGJ0bjtcbiAgfVxuXG4gIC8vIFJlcGFpbnRzIGV2ZXJ5IG1hbnVhbCBidXR0b24gb2YgdGhlIGRldGFpbCB2aWV3IGFmdGVyIG9uZSBjaGFuZ2VkIHRoZVxuICAvLyBvdGhlcnMuIE9ubHkgdGhlIGJ1dHRvbnMsIG5vdCByZW5kZXIoKTogYSByZWJ1aWxkIHdvdWxkIHJlY3JlYXRlIGV2ZXJ5XG4gIC8vIGJsb2NrJ3MgZWRpdG9ycywgaW5jbHVkaW5nIGEgcm93IGJlaW5nIGVkaXRlZC4gRm91bmQgdmlhIHRoZSBET00gbGlrZSB0aGVcbiAgLy8gU3VidHlwIGNvbG9yIGRvdHMgLSBmcm9udG1hdHRlci1ibG9ja3MuanMgYnVpbGRzIHRoZSBmb290ZXJzLCBubyBsaXN0IG9mXG4gIC8vIHRoZW0gbGl2ZXMgaGVyZS5cbiAgc3luY01hbnVhbFRvZ2dsZXModHlwKSB7XG4gICAgdGhpcy5jb250ZW50RWwucXVlcnlTZWxlY3RvcihcIi50eXAtbWFudWFsLXR5cFwiKT8udHlwU2hvd01hbnVhbFN0YXRlKHRoaXMuZW5zdXJlVHlwTWFudWFsKClbdHlwXSAhPT0gZmFsc2UpO1xuICAgIGZvciAoY29uc3QgZWwgb2YgdGhpcy5jb250ZW50RWwucXVlcnlTZWxlY3RvckFsbChcIi50eXAtbWFudWFsLXN1YnR5cFwiKSkge1xuICAgICAgZWwudHlwU2hvd01hbnVhbFN0YXRlKGlzU3VidHlwTWFudWFsKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXAsIGVsLnR5cFN1YnR5cCkpO1xuICAgIH1cbiAgfVxuXG4gIHJlbmRlclJlZ2lzdGVyZWRJdGVtKHR5cCwgY291bnQsIHsgZHJhZ2dhYmxlID0gZmFsc2UsIGluZGV4ID0gLTEgfSA9IHt9KSB7XG4gICAgY29uc3QgdHJlZUl0ZW0gPSB0aGlzLmxpc3RFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtXCIgfSk7XG4gICAgY29uc3Qgc2VsZiA9IHRyZWVJdGVtLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW0tc2VsZiBpcy1jbGlja2FibGVcIiB9KTtcblxuICAgIGxldCBuYW1lRWw7XG4gICAgdGhpcy5yZW5kZXJDb2xvclBpY2tlcihzZWxmLCB0eXAsIChuZXdDb2xvcikgPT4ge1xuICAgICAgaWYgKG5hbWVFbCAmJiB0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnR5cExpc3QpIG5hbWVFbC5zdHlsZS5jb2xvciA9IG5ld0NvbG9yO1xuICAgIH0pO1xuXG4gICAgbmFtZUVsID0gc2VsZi5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtLWlubmVyXCIsIHRleHQ6IHR5cCB9KTtcbiAgICBjb25zdCBjb2xvciA9IHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MudHlwTGlzdCA/IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cENvbG9yc1t0eXBdIDogbnVsbDtcbiAgICBpZiAoY29sb3IpIG5hbWVFbC5zdHlsZS5jb2xvciA9IGNvbG9yO1xuXG4gICAgLy8gU2Vjb25kIGNvbHVtbiwgY3ljbGVkIGJ5IHRoZSBoZWFkZXIgYnV0dG9uIChzZWUgU0VDT05EQVJZX01PREVTKS5cbiAgICBjb25zdCBzZWNvbmRhcnkgPSB0aGlzLnNlY29uZGFyeU1vZGUoKTtcbiAgICBpZiAoc2Vjb25kYXJ5ID09PSBcImRlc2NyaXB0aW9uXCIpIHRoaXMucmVuZGVyRGVzY3JpcHRpb25JbnB1dChzZWxmLCB0eXApO1xuICAgIGVsc2UgaWYgKHNlY29uZGFyeSA9PT0gXCJzdWJ0eXBzXCIpIHRoaXMucmVuZGVyU3VidHlwUHJldmlldyhzZWxmLCB0eXApO1xuXG4gICAgdGhpcy5yZW5kZXJDb3VudEZsYWlyKHNlbGYsIGNvdW50KTtcblxuICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgIGlmICh0aGlzLmlzRWRpdGluZykgcmV0dXJuO1xuICAgICAgdGhpcy5vcGVuVHlwU2V0dGluZ3ModHlwKTtcbiAgICB9KTtcbiAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJjb250ZXh0bWVudVwiLCAoZXZlbnQpID0+IHtcbiAgICAgIC8vIFdoaWxlIHJlbmFtaW5nLCB0aGUgdGV4dCBmaWVsZCdzIG93biBtZW51IChjb3B5LCBwYXN0ZSkgYXBwbGllcy5cbiAgICAgIGlmICh0aGlzLmlzRWRpdGluZykgcmV0dXJuO1xuICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgdGhpcy5zaG93VHlwTWVudShldmVudCwgdHlwLCBzZWxmLCBuYW1lRWwpO1xuICAgIH0pO1xuXG4gICAgLy8gT25seSBpbiBtYW51YWwgc29ydCBtb2RlIChzZWUgcmVuZGVyKCkpOiB0aGUgd2hvbGUgcm93IGNhbiBiZSBkcmFnZ2VkXG4gICAgLy8gKGEgZHJhZyBzdGFydGluZyBvbiB0aGUgZG90IG9yIGluIHRoZSBkZXNjcmlwdGlvbiBmaWVsZCBkb2Vzbid0IGNvdW50IC1cbiAgICAvLyB0aG9zZSB0YWtlIHRoZSBtb3VzZWRvd24gdGhlbXNlbHZlcykuIE1vdmVzIGVudHJpZXMgaW4gc2V0dGluZ3MudHlwcyxcbiAgICAvLyB0aGUgbGlzdCB0aGF0IGlzIHRoZSBkaXNwbGF5IG9yZGVyIGluIG1hbnVhbCBtb2RlLlxuICAgIGlmIChkcmFnZ2FibGUpIHtcbiAgICAgIHNlbGYuZHJhZ2dhYmxlID0gdHJ1ZTtcbiAgICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImRyYWdzdGFydFwiLCAoZXZlbnQpID0+IHtcbiAgICAgICAgZXZlbnQuZGF0YVRyYW5zZmVyLmVmZmVjdEFsbG93ZWQgPSBcIm1vdmVcIjtcbiAgICAgICAgZXZlbnQuZGF0YVRyYW5zZmVyLnNldERhdGEoXCJ0ZXh0L3BsYWluXCIsIFN0cmluZyhpbmRleCkpO1xuICAgICAgICBzZWxmLmNsYXNzTGlzdC5hZGQoXCJpcy1kcmFnZ2luZ1wiKTtcbiAgICAgIH0pO1xuICAgICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiZHJhZ2VuZFwiLCAoKSA9PiBzZWxmLmNsYXNzTGlzdC5yZW1vdmUoXCJpcy1kcmFnZ2luZ1wiKSk7XG4gICAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJkcmFnb3ZlclwiLCAoZXZlbnQpID0+IHtcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgY29uc3QgcmVjdCA9IHNlbGYuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgICAgIGNvbnN0IGlzQWZ0ZXIgPSBldmVudC5jbGllbnRZIC0gcmVjdC50b3AgPiByZWN0LmhlaWdodCAvIDI7XG4gICAgICAgIHNlbGYuY2xhc3NMaXN0LnRvZ2dsZShcImlzLWRyb3AtYmVmb3JlXCIsICFpc0FmdGVyKTtcbiAgICAgICAgc2VsZi5jbGFzc0xpc3QudG9nZ2xlKFwiaXMtZHJvcC1hZnRlclwiLCBpc0FmdGVyKTtcbiAgICAgIH0pO1xuICAgICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiZHJhZ2xlYXZlXCIsICgpID0+IHNlbGYuY2xhc3NMaXN0LnJlbW92ZShcImlzLWRyb3AtYmVmb3JlXCIsIFwiaXMtZHJvcC1hZnRlclwiKSk7XG4gICAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJkcm9wXCIsIGFzeW5jIChldmVudCkgPT4ge1xuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICBjb25zdCBpc0FmdGVyID0gc2VsZi5jbGFzc0xpc3QuY29udGFpbnMoXCJpcy1kcm9wLWFmdGVyXCIpO1xuICAgICAgICBzZWxmLmNsYXNzTGlzdC5yZW1vdmUoXCJpcy1kcm9wLWJlZm9yZVwiLCBcImlzLWRyb3AtYWZ0ZXJcIik7XG5cbiAgICAgICAgY29uc3QgZnJvbUluZGV4ID0gTnVtYmVyKGV2ZW50LmRhdGFUcmFuc2Zlci5nZXREYXRhKFwidGV4dC9wbGFpblwiKSk7XG4gICAgICAgIGlmIChOdW1iZXIuaXNOYU4oZnJvbUluZGV4KSB8fCBmcm9tSW5kZXggPT09IGluZGV4KSByZXR1cm47XG5cbiAgICAgICAgbGV0IGluc2VydEJlZm9yZSA9IGlzQWZ0ZXIgPyBpbmRleCArIDEgOiBpbmRleDtcbiAgICAgICAgaWYgKGZyb21JbmRleCA8IGluc2VydEJlZm9yZSkgaW5zZXJ0QmVmb3JlIC09IDE7XG5cbiAgICAgICAgY29uc3QgdHlwcyA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cHM7XG4gICAgICAgIGNvbnN0IFttb3ZlZF0gPSB0eXBzLnNwbGljZShmcm9tSW5kZXgsIDEpO1xuICAgICAgICB0eXBzLnNwbGljZShpbnNlcnRCZWZvcmUsIDAsIG1vdmVkKTtcbiAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICAvLyBSaWdodC1jbGljayBvbiBhIHJlZ2lzdGVyZWQgVFlQOiB0aGUgYWN0aW9ucyBvZiB0aGUgZGV0YWlsIGhlYWRlciBwbHVzXG4gIC8vIHNlYXJjaCwgQmFzZSBhbmQgc29ydGluZywgd2l0aG91dCBvcGVuaW5nIHRoZSBkZXRhaWwgdmlldy4gXCJNYW51YWxseVxuICAvLyBjcmVhdGFibGVcIiBzdGF5cyBpbiB0aGUgZGV0YWlsIHZpZXcgLSBhIHN0YXRlLCBub3QgYW4gYWN0aW9uLiBUaGUgcm93c1xuICAvLyBiZWxvdyB0aGUgc2VwYXJhdG9yIGtlZXAgcmlnaHQtY2xpY2sgPSBzZWFyY2g6IHRoZXkgaGF2ZSBubyBzZXR0aW5ncyB0b1xuICAvLyBhY3Qgb24uXG4gIHNob3dUeXBNZW51KGV2ZW50LCB0eXAsIHNlbGYsIG5hbWVFbCkge1xuICAgIGNvbnN0IG1lbnUgPSBuZXcgTWVudSgpO1xuICAgIG1lbnUuYWRkSXRlbSgoaXRlbSkgPT4gaXRlbS5zZXRUaXRsZShcIlNlYXJjaCBub3Rlc1wiKS5zZXRJY29uKFwic2VhcmNoXCIpLm9uQ2xpY2soKCkgPT4gdGhpcy5vcGVuU2VhcmNoKHR5cCkpKTtcbiAgICBtZW51LmFkZFNlcGFyYXRvcigpO1xuICAgIG1lbnUuYWRkSXRlbSgoaXRlbSkgPT5cbiAgICAgIGl0ZW1cbiAgICAgICAgLnNldFRpdGxlKFwiUmVuYW1lXCIpXG4gICAgICAgIC5zZXRJY29uKFwicGVuY2lsXCIpXG4gICAgICAgIC5vbkNsaWNrKCgpID0+IHRoaXMuc3RhcnRMaXN0UmVuYW1lKHR5cCwgc2VsZiwgbmFtZUVsKSlcbiAgICApO1xuICAgIG1lbnUuYWRkSXRlbSgoaXRlbSkgPT5cbiAgICAgIGl0ZW1cbiAgICAgICAgLnNldFRpdGxlKFwiUmVuYW1lIGFuZCB1cGRhdGUgbm90ZXNcIilcbiAgICAgICAgLnNldEljb24oXCJwZW5jaWxcIilcbiAgICAgICAgLm9uQ2xpY2soKCkgPT4gdGhpcy5zdGFydExpc3RSZW5hbWUodHlwLCBzZWxmLCBuYW1lRWwsIHsgdXBkYXRlTm90ZXM6IHRydWUgfSkpXG4gICAgKTtcbiAgICBtZW51LmFkZEl0ZW0oKGl0ZW0pID0+XG4gICAgICBpdGVtXG4gICAgICAgIC5zZXRUaXRsZShcIkRlbGV0ZVwiKVxuICAgICAgICAuc2V0SWNvbihcInRyYXNoXCIpXG4gICAgICAgIC5zZXRXYXJuaW5nKHRydWUpXG4gICAgICAgIC5vbkNsaWNrKCgpID0+IHRoaXMuc2hvd0RlbGV0ZUNvbmZpcm0odHlwKSlcbiAgICApO1xuICAgIG1lbnUuYWRkU2VwYXJhdG9yKCk7XG4gICAgLy8gTGlrZSB0aGUgY29tbWFuZDogd2l0aG91dCB0aGUgQmFzZXMgY29yZSBwbHVnaW4gdGhlIGZpbGUgY291bGRuJ3QgYmVcbiAgICAvLyBvcGVuZWQuXG4gICAgaWYgKGlzQmFzZXNFbmFibGVkKHRoaXMuYXBwKSkge1xuICAgICAgbWVudS5hZGRJdGVtKChpdGVtKSA9PlxuICAgICAgICBpdGVtXG4gICAgICAgICAgLnNldFRpdGxlKFwiQ3JlYXRlIEJhc2VcIilcbiAgICAgICAgICAuc2V0SWNvbihcInRhYmxlXCIpXG4gICAgICAgICAgLm9uQ2xpY2socnVuT3JSZXBvcnRFcnJvcihcIkNyZWF0ZSBCYXNlXCIsICgpID0+IGNyZWF0ZUJhc2VGb3IodGhpcy5wbHVnaW4sIHsgdHlwLCBzdWJ0eXA6IG51bGwgfSkpKVxuICAgICAgKTtcbiAgICB9XG4gICAgbWVudS5hZGRJdGVtKChpdGVtKSA9PlxuICAgICAgaXRlbVxuICAgICAgICAuc2V0VGl0bGUoXCJTb3J0IGZyb250bWF0dGVyIGZvciB0aGlzIFRZUFwiKVxuICAgICAgICAuc2V0SWNvbihcImFycm93LWRvd24tdXBcIilcbiAgICAgICAgLm9uQ2xpY2socnVuT3JSZXBvcnRFcnJvcihcIkZyb250bWF0dGVyIHNvcnRpbmdcIiwgKCkgPT4gcnVuRnJvbnRtYXR0ZXJTb3J0KHRoaXMucGx1Z2luLCB0eXApKSlcbiAgICApO1xuICAgIG1lbnUuc2hvd0F0TW91c2VFdmVudChldmVudCk7XG4gIH1cblxuICAvLyBBIHJlYWwgaW5wdXQsIHNvIHRoZSBkZXNjcmlwdGlvbiBjYW4gYmUgZWRpdGVkIHJpZ2h0IGluIHRoZSBsaXN0LiBJdHNcbiAgLy8gY2xpY2sgbXVzdCBOT1QgdHJpZ2dlciB0aGUgcm93ICh3aGljaCB3b3VsZCBvcGVuIHRoZSBkZXRhaWwgdmlldykuXG4gIHJlbmRlckRlc2NyaXB0aW9uSW5wdXQoc2VsZiwgdHlwKSB7XG4gICAgY29uc3QgZGVzY0lucHV0ID0gc2VsZi5jcmVhdGVFbChcImlucHV0XCIsIHtcbiAgICAgIHR5cGU6IFwidGV4dFwiLFxuICAgICAgY2xzOiBcInR5cC1saXN0LWRlc2NyaXB0aW9uLWlucHV0XCIsXG4gICAgfSk7XG4gICAgZGVzY0lucHV0LnZhbHVlID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwRGVzY3JpcHRpb25zW3R5cF0gPz8gXCJcIjtcbiAgICBkZXNjSW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIChldmVudCkgPT4gZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCkpO1xuICAgIGRlc2NJbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiY2hhbmdlXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHZhbHVlID0gZGVzY0lucHV0LnZhbHVlLnRyaW0oKTtcbiAgICAgIGlmICh2YWx1ZSkgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwRGVzY3JpcHRpb25zW3R5cF0gPSB2YWx1ZTtcbiAgICAgIGVsc2UgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cERlc2NyaXB0aW9uc1t0eXBdO1xuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgfSk7XG4gIH1cblxuICAvLyBcIihTdWJ0eXAgMSwgU3VidHlwIDIpXCIgaW5zdGVhZCBvZiB0aGUgZGVzY3JpcHRpb24gLSB0aGUgc2FtZSBsb29rIGFzIHRoZVxuICAvLyBwcmV2aWV3IGluIHRoZSBzZXBhcmF0ZSBUWVAtUGlja2VyIChzaGFyZWQgbmFtZUNvbG9yIGluIHR5cC1jb2xvcnMuanMpOlxuICAvLyBicmFja2V0cyBhbmQgY29tbWFzIG11dGVkLCBlYWNoIG5hbWUgaW4gaXRzIFN1YnR5cCBjb2xvci4gT25seSByZWdpc3RlcmVkXG4gIC8vIFN1YnR5cHMgYW5kIG5vIGNvdW50cyAtIHVucmVnaXN0ZXJlZCB2YWx1ZXMgaGF2ZSBubyBjb2xvciwgYW5kIGNvdW50c1xuICAvLyB3b3VsZCBtYWtlIHRoZSByb3cgdW5yZWFkYWJsZS4gRGlzcGxheSBvbmx5OyBjbGljayBhbmQgcmlnaHQtY2xpY2sgYmVsb25nXG4gIC8vIHRvIHRoZSByb3cuIExlZnQgb3IgcmlnaHQgYWxpZ25tZW50IGlzIGEgU3R5bGUgU2V0dGluZ3MgYm9keSBjbGFzcyAoc2VlXG4gIC8vIEBzZXR0aW5ncyBhbmQgLnR5cC1saXN0LXN1YnR5cHMgaW4gc3R5bGVzLmNzcyk7IHRoZSBtYXJrdXAgaXMgdGhlIHNhbWUuXG4gIHJlbmRlclN1YnR5cFByZXZpZXcoc2VsZiwgdHlwKSB7XG4gICAgY29uc3Qgc3VidHlwcyA9IGdldFN1YnR5cE5hbWVzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXApO1xuICAgIGlmIChzdWJ0eXBzLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuXG4gICAgY29uc3QgY29sb3JpemUgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnR5cExpc3Q7XG4gICAgY29uc3Qgd3JhcCA9IHNlbGYuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtbGlzdC1zdWJ0eXBzXCIgfSk7XG4gICAgd3JhcC5hcHBlbmRUZXh0KFwiKFwiKTtcbiAgICBzdWJ0eXBzLmZvckVhY2goKHN1YnR5cCwgaW5kZXgpID0+IHtcbiAgICAgIGlmIChpbmRleCA+IDApIHdyYXAuYXBwZW5kVGV4dChcIiwgXCIpO1xuICAgICAgY29uc3Qgc3BhbiA9IHdyYXAuY3JlYXRlU3Bhbih7IHRleHQ6IHN1YnR5cCB9KTtcbiAgICAgIGlmIChjb2xvcml6ZSkgc3Bhbi5zdHlsZS5jb2xvciA9IG5hbWVDb2xvcih0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwLCBzdWJ0eXApLmNvbG9yO1xuICAgIH0pO1xuICAgIHdyYXAuYXBwZW5kVGV4dChcIilcIik7XG4gIH1cblxuICByZW5kZXJVbnJlZ2lzdGVyZWRJdGVtKHR5cCwgY291bnQpIHtcbiAgICBjb25zdCB0cmVlSXRlbSA9IHRoaXMubGlzdEVsLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW1cIiB9KTtcbiAgICBjb25zdCBzZWxmID0gdHJlZUl0ZW0uY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1zZWxmIGlzLWNsaWNrYWJsZSB0eXAtdW5yZWdpc3RlcmVkXCIgfSk7XG4gICAgc2VsZi5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtLWlubmVyXCIsIHRleHQ6IGRpc3BsYXlUeXBLZXkodHlwKSB9KTtcbiAgICB0aGlzLnJlbmRlckNvdW50RmxhaXIoc2VsZiwgY291bnQpO1xuXG4gICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5yZWdpc3RlclR5cCh0eXApKTtcbiAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJjb250ZXh0bWVudVwiLCAoZXZlbnQpID0+IHtcbiAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIHRoaXMub3BlblNlYXJjaCh0eXApO1xuICAgIH0pO1xuICB9XG5cbiAgLy8gRXZlcnkgU1VCVFlQIHZhbHVlIHRoYXQgb2NjdXJzIGluIG5vdGVzIGJ1dCBpc24ndCByZWdpc3RlcmVkIHVuZGVyIGl0cyBUWVBcbiAgLy8gLSBhY3Jvc3MgdGhlIHZhdWx0LCB1bmxpa2UgcmVuZGVyVW5yZWdpc3RlcmVkU3VidHlwcygpIGluIHRoZSBkZXRhaWwgdmlldy5cbiAgLy8gVGhlIGluZGV4IGtlZXBzIGJ1Y2tldHMgZm9yIEFMTCBUWVAga2V5cywgdW5yZWdpc3RlcmVkIG9uZXMgaW5jbHVkZWQsIHNvXG4gIC8vIHRoZWlyIFN1YnR5cHMgY29tZSBhbG9uZyAoYSBjbGljayB0aGVuIHJlZ2lzdGVycyBib3RoLCBzZWVcbiAgLy8gcmVnaXN0ZXJUeXBXaXRoU3VidHlwKS5cbiAgLy9cbiAgLy8gU29ydGVkIGJ5IGNvdW50LCB0aGVuIGJ5IHJvdyB0ZXh0IChUWVAsIHRoZW4gU3VidHlwKSAtIGxpa2UgdGhlIGRldGFpbFxuICAvLyB2aWV3LiBEZWxpYmVyYXRlbHkgTk9UIGJ5IHRoZSBsaXN0J3Mgc29ydCBidXR0b246IFwiY29sb3JcIiBhbmQgXCJtYW51YWxcIlxuICAvLyBtZWFuIG5vdGhpbmcgZm9yIHVucmVnaXN0ZXJlZCB2YWx1ZXMuXG4gIC8vXG4gIC8vIEEgbm90ZSB3aXRob3V0IGEgVFlQIGlzIGxlZnQgb3V0OiB0aGUgaW5kZXggZHJvcHMgaXRzIFNVQlRZUCBhbHJlYWR5IChzZWVcbiAgLy8gYWdncmVnYXRlKCkgaW4gdHlwLWluZGV4LmpzKSwgYSBTVUJUWVAgd2l0aG91dCBhIFRZUCBoYXMgbm8gY29udGV4dC5cbiAgdW5yZWdpc3RlcmVkU3VidHlwUm93cygpIHtcbiAgICBjb25zdCByZWdpc3RlcmVkID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwcztcbiAgICBjb25zdCByb3dzID0gW107XG4gICAgZm9yIChjb25zdCBbdHlwLCBidWNrZXRdIG9mIHRoaXMucGx1Z2luLnR5cEluZGV4LnN1YnR5cENvdW50cygpKSB7XG4gICAgICBjb25zdCBrbm93biA9IGdldFN1YnR5cE5hbWVzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXApO1xuICAgICAgZm9yIChjb25zdCBbc3VidHlwLCBjb3VudF0gb2YgYnVja2V0LmNvdW50cykge1xuICAgICAgICBpZiAoa25vd24uaW5jbHVkZXMoc3VidHlwKSkgY29udGludWU7XG4gICAgICAgIHJvd3MucHVzaCh7IHR5cCwgc3VidHlwLCBjb3VudCwgdHlwUmVnaXN0ZXJlZDogcmVnaXN0ZXJlZC5pbmNsdWRlcyh0eXApIH0pO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcm93cy5zb3J0KChhLCBiKSA9PiBiLmNvdW50IC0gYS5jb3VudCB8fCBhLnR5cC5sb2NhbGVDb21wYXJlKGIudHlwKSB8fCBhLnN1YnR5cC5sb2NhbGVDb21wYXJlKGIuc3VidHlwKSk7XG4gIH1cblxuICAvLyBcIk5PVElaIC8gS3VyeiBHZXNjaGljaHRlXCIgLSB0aGUgU3VidHlwIGFsb25lIHdvdWxkIGJlIGFtYmlndW91cywgdGhlIHNhbWVcbiAgLy8gbmFtZSBjYW4gZXhpc3QgdW5kZXIgc2V2ZXJhbCBUWVAgZW50cmllcy4gSWYgdGhlIFRZUCBpcyByZWdpc3RlcmVkLCBpdHNcbiAgLy8gcGFydCBjYXJyaWVzIGl0cyBjb2xvciAob3IgYSBkb3QsIGRlcGVuZGluZyBvbiBcIlRZUC1QYW5lXCIgY29sb3JpbmcpLFxuICAvLyB0b25lZCBkb3duIGJ5IHRoZSBTdHlsZSBTZXR0aW5nIFwiQ29sb3IgaW4gdW5yZWdpc3RlcmVkIFN1YnR5cCByb3dzXCIgc29cbiAgLy8gdGhlc2Ugcm93cyBzdGF5IGJlaGluZCB0aGUgcmVnaXN0ZXJlZCBlbnRyaWVzIGFib3ZlLiBJZiB0aGUgVFlQIGlzbid0XG4gIC8vIHJlZ2lzdGVyZWQgZWl0aGVyLCB0aGUgd2hvbGUgcm93IGlzIG11dGVkIGxpa2UgdGhlIGVudHJpZXMgYWJvdmUgaXQuXG4gIHJlbmRlclVucmVnaXN0ZXJlZFN1YnR5cEl0ZW0oeyB0eXAsIHN1YnR5cCwgY291bnQsIHR5cFJlZ2lzdGVyZWQgfSkge1xuICAgIGNvbnN0IHRyZWVJdGVtID0gdGhpcy5saXN0RWwuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbVwiIH0pO1xuICAgIGNvbnN0IHNlbGYgPSB0cmVlSXRlbS5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtLXNlbGYgaXMtY2xpY2thYmxlIHR5cC11bnJlZ2lzdGVyZWRcIiB9KTtcblxuICAgIGNvbnN0IGNvbG9yaXplID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0O1xuICAgIGNvbnN0IHsgY29sb3IsIGlzRGVmYXVsdCB9ID0gbmFtZUNvbG9yKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXApO1xuICAgIGlmICh0eXBSZWdpc3RlcmVkICYmICFjb2xvcml6ZSkge1xuICAgICAgY29uc3Qgd3JhcCA9IHNlbGYuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1jb2xvci13cmFwIHR5cC11bnJlZ2lzdGVyZWQtc3VidHlwLWNvbG9yXCIgfSk7XG4gICAgICBwYWludENvbG9yRG90KHdyYXAuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1jb2xvci1kb3RcIiB9KSwgY29sb3IsIGlzRGVmYXVsdCk7XG4gICAgfVxuXG4gICAgY29uc3QgaW5uZXIgPSBzZWxmLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW0taW5uZXJcIiB9KTtcbiAgICBjb25zdCB0eXBFbCA9IGlubmVyLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLXVucmVnaXN0ZXJlZC1zdWJ0eXAtdHlwXCIsIHRleHQ6IGRpc3BsYXlUeXBLZXkodHlwKSB9KTtcbiAgICBpZiAodHlwUmVnaXN0ZXJlZCAmJiBjb2xvcml6ZSAmJiAhaXNEZWZhdWx0KSB7XG4gICAgICB0eXBFbC5zdHlsZS5jb2xvciA9IGNvbG9yO1xuICAgICAgdHlwRWwuYWRkQ2xhc3MoXCJ0eXAtdW5yZWdpc3RlcmVkLXN1YnR5cC1jb2xvclwiKTtcbiAgICB9XG4gICAgaW5uZXIuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtdW5yZWdpc3RlcmVkLXN1YnR5cC1zbGFzaFwiLCB0ZXh0OiBcIiAvIFwiIH0pO1xuICAgIGlubmVyLmNyZWF0ZVNwYW4oeyB0ZXh0OiBkaXNwbGF5VHlwS2V5KHN1YnR5cCkgfSk7XG5cbiAgICB0aGlzLnJlbmRlckNvdW50RmxhaXIoc2VsZiwgY291bnQpO1xuXG4gICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5yZWdpc3RlclR5cFdpdGhTdWJ0eXAodHlwLCBzdWJ0eXApKTtcbiAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJjb250ZXh0bWVudVwiLCAoZXZlbnQpID0+IHtcbiAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIHRoaXMub3BlblN1YnR5cFNlYXJjaCh0eXAsIHN1YnR5cCk7XG4gICAgfSk7XG4gIH1cblxuICAvLyBDbGlja2luZyBzdWNoIGEgcm93IHJlZ2lzdGVycyB0aGUgU3VidHlwIGFuZCwgaWYgbmVlZGVkLCBpdHMgVFlQLiBUWVBcbiAgLy8gZmlyc3QsIHRoZW4gU3VidHlwIC0gbmVjZXNzYXJpbHk6IHJlZ2lzdGVyaW5nIGEgVFlQIGNhbiBjbGVhbiBpdHMgdmFsdWUgaW5cbiAgLy8gdGhlIG5vdGVzIChcIiBidWNoXCIgLT4gXCJCVUNIXCIpLCBhbmQgdGhlIFN1YnR5cCBwYXNzIG11c3QgdGhlbiB1c2UgdGhlIE5FV1xuICAvLyBUWVAgbmFtZSBvciByZW5hbWVTdWJ0eXBJbk5vdGVzKCkgZmluZHMgbm8gZmlsZS5cbiAgLy9cbiAgLy8gTm8gY29uZmlybWF0aW9uOiBpdCBvbmx5IHJlZ2lzdGVycy4gTm90ZXMgY2hhbmdlIG9ubHkgd2hlbiBhIHJhdyB2YWx1ZSB3YXNcbiAgLy8gdW5jbGVhbiBhbmQgZ2V0cyBjbGVhbmVkIC0gYSBjbGVhbiB2YWx1ZSB0b3VjaGVzIG5vIGZpbGUuXG4gIGFzeW5jIHJlZ2lzdGVyVHlwV2l0aFN1YnR5cCh0eXBLZXksIHN1YnR5cEtleSkge1xuICAgIGNvbnN0IGJ1Y2tldCA9IHRoaXMucGx1Z2luLnR5cEluZGV4LnN1YnR5cEJ1Y2tldCh0eXBLZXkpO1xuICAgIGNvbnN0IHR5cFJlc3VsdCA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cHMuaW5jbHVkZXModHlwS2V5KVxuICAgICAgPyB7IHR5cDogdHlwS2V5LCByZW5hbWVkOiAwIH1cbiAgICAgIDogYXdhaXQgdGhpcy5hcHBseVR5cFJlZ2lzdHJhdGlvbih0eXBLZXkpO1xuICAgIGlmICghdHlwUmVzdWx0KSByZXR1cm47XG5cbiAgICBjb25zdCBzdWJ0eXBSZXN1bHQgPSBhd2FpdCB0aGlzLmFwcGx5U3VidHlwUmVnaXN0cmF0aW9uKHR5cFJlc3VsdC50eXAsIHN1YnR5cEtleSwgYnVja2V0KTtcbiAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICB0aGlzLnJlbmRlcigpO1xuICAgIHRoaXMucmVmcmVzaE90aGVyVmlld3MoKTtcblxuICAgIGlmICghc3VidHlwUmVzdWx0KSByZXR1cm47XG4gICAgY29uc3QgcGFydHMgPSBbXTtcbiAgICBpZiAodHlwUmVzdWx0LnR5cCAhPT0gdHlwS2V5KSBwYXJ0cy5wdXNoKGBUWVAgJHt0eXBSZXN1bHQudHlwfWApO1xuICAgIHBhcnRzLnB1c2goYFN1YnR5cCAke3N1YnR5cFJlc3VsdC5zdWJ0eXB9YCk7XG4gICAgY29uc3QgY2hhbmdlZCA9IHR5cFJlc3VsdC5yZW5hbWVkICsgc3VidHlwUmVzdWx0LnJlbmFtZWQ7XG4gICAgbmV3IE5vdGljZShgJHtqb2luQW5kKHBhcnRzKX0gcmVnaXN0ZXJlZCR7Y2hhbmdlZCA+IDAgPyBgLCAke3BsdXJhbChjaGFuZ2VkLCBcIm5vdGVcIil9IHVwZGF0ZWRgIDogXCJcIn0uYCk7XG4gIH1cblxuICByZW5kZXJUeXBTZXR0aW5ncyh0eXApIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcblxuICAgIGNvbnN0IGhlYWRlciA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWRldGFpbC1oZWFkZXJcIiB9KTtcbiAgICBjb25zdCBiYWNrQnRuID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiB0eXAtYmFja1wiLCBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIkJhY2tcIiB9IH0pO1xuICAgIHNldEljb24oYmFja0J0biwgXCJhcnJvdy1sZWZ0XCIpO1xuICAgIGJhY2tCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuY2xvc2VUeXBTZXR0aW5ncygpKTtcblxuICAgIGNvbnN0IHRpdGxlRWwgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1kZXRhaWwtdGl0bGVcIiwgdGV4dDogdHlwIH0pO1xuICAgIGNvbnN0IHRpdGxlQ29sb3IgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnR5cExpc3QgPyB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBDb2xvcnNbdHlwXSA6IG51bGw7XG4gICAgLy8gQSBjdXN0b20gcHJvcGVydHkgaW5zdGVhZCBvZiBjb2xvcjogYW4gaW5saW5lIGNvbG9yIGJlYXRzIGV2ZXJ5XG4gICAgLy8gc3R5bGVzaGVldCBydWxlLCBhbmQgdGhlIGFjY2VudCBjb2xvciBvbiBob3ZlciAoLnR5cC1zZWFyY2hhYmxlKSB3b3VsZFxuICAgIC8vIG5lZWQgIWltcG9ydGFudC5cbiAgICBpZiAodGl0bGVDb2xvcikgdGl0bGVFbC5zdHlsZS5zZXRQcm9wZXJ0eShcIi0tdHlwLW5hbWUtY29sb3JcIiwgdGl0bGVDb2xvcik7XG4gICAgdGhpcy5tYWtlU2VhcmNoYWJsZSh0aXRsZUVsLCAoKSA9PiB0aGlzLm9wZW5TZWFyY2godHlwKSk7XG5cbiAgICBjb25zdCB7IGNvdW50cyB9ID0gdGhpcy5wbHVnaW4udHlwSW5kZXgudHlwQ291bnRzKCk7XG4gICAgaGVhZGVyLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLWRldGFpbC1jb3VudFwiLCB0ZXh0OiBTdHJpbmcoY291bnRzLmdldCh0eXApID8/IDApIH0pO1xuXG4gICAgLy8gTGVmdCBvZiB0aGUgcGxhaW4gcmVuYW1lIGJ1dHRvbiwgaGlnaGxpZ2h0ZWQgaW4gYWNjZW50IGNvbG9yOiB0aGlzIG9uZVxuICAgIC8vIGFsc28gcmV3cml0ZXMgdGhlIFRZUCBvZiBldmVyeSBhZmZlY3RlZCBub3RlIChhZnRlciBjb25maXJtYXRpb24sIHNlZVxuICAgIC8vIHN0YXJ0RGV0YWlsUmVuYW1lKS5cbiAgICBjb25zdCByZW5hbWVXaXRoTm90ZXNCdG4gPSBoZWFkZXIuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJjbGlja2FibGUtaWNvbiB0eXAtZGV0YWlsLXJlbmFtZS1ub3Rlc1wiLFxuICAgICAgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJSZW5hbWUgYW5kIHVwZGF0ZSBub3Rlc1wiIH0sXG4gICAgfSk7XG4gICAgc2V0SWNvbihyZW5hbWVXaXRoTm90ZXNCdG4sIFwicGVuY2lsXCIpO1xuICAgIHJlbmFtZVdpdGhOb3Rlc0J0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5zdGFydERldGFpbFJlbmFtZSh0eXAsIHRpdGxlRWwsIHsgdXBkYXRlTm90ZXM6IHRydWUgfSkpO1xuXG4gICAgY29uc3QgcmVuYW1lQnRuID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiB0eXAtZGV0YWlsLXJlbmFtZVwiLCBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIlJlbmFtZVwiIH0gfSk7XG4gICAgc2V0SWNvbihyZW5hbWVCdG4sIFwicGVuY2lsXCIpO1xuICAgIHJlbmFtZUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5zdGFydERldGFpbFJlbmFtZSh0eXAsIHRpdGxlRWwpKTtcblxuICAgIC8vIEJldHdlZW4gcmVuYW1lIGFuZCBkZWxldGUsIGluIHRoZSBzYW1lIHNwb3QgYXMgZm9yIGEgU3VidHlwIChzZWVcbiAgICAvLyByZW5kZXJTZWN0aW9uRm9vdGVyKS5cbiAgICB0aGlzLnJlbmRlck1hbnVhbFRvZ2dsZShoZWFkZXIsIHR5cCk7XG5cbiAgICBjb25zdCBkZWxldGVCdG4gPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIHR5cC1kZXRhaWwtZGVsZXRlXCIsIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiRGVsZXRlXCIgfSB9KTtcbiAgICBzZXRJY29uKGRlbGV0ZUJ0biwgXCJ0cmFzaFwiKTtcbiAgICBkZWxldGVCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuc2hvd0RlbGV0ZUNvbmZpcm0odHlwKSk7XG5cbiAgICBjb25zdCBib2R5ID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtZGV0YWlsLWJvZHlcIiB9KTtcblxuICAgIC8vIE9uZSByb3cgYmVsb3cgdGhlIGhlYWRlcjogdGhlIFRZUCBjb2xvciBvbiB0aGUgbGVmdCwgdGhlIGRlc2NyaXB0aW9uXG4gICAgLy8gZmlsbGluZyB0aGUgcmVzdC5cbiAgICBjb25zdCBvcHRpb25zSGVhZGVyID0gYm9keS5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWZyb250bWF0dGVyLWhlYWRlciB0eXAtb3B0aW9ucy1oZWFkZXJcIiB9KTtcblxuICAgIGNvbnN0IGNvbG9yUm93ID0gb3B0aW9uc0hlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWRldGFpbC1jb2xvci1yb3dcIiB9KTtcbiAgICB0aGlzLnJlbmRlckNvbG9yUGlja2VyKFxuICAgICAgY29sb3JSb3csXG4gICAgICB0eXAsXG4gICAgICAobmV3Q29sb3IpID0+IHtcbiAgICAgICAgaWYgKCF0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnR5cExpc3QpIHJldHVybjtcbiAgICAgICAgLy8gU2FtZSBjdXN0b20gcHJvcGVydHkgYXMgYWJvdmUsIG5vdCBzdHlsZS5jb2xvciAoc2VlIHRoZXJlKS5cbiAgICAgICAgdGl0bGVFbC5zdHlsZS5zZXRQcm9wZXJ0eShcIi0tdHlwLW5hbWUtY29sb3JcIiwgbmV3Q29sb3IpO1xuICAgICAgfSxcbiAgICAgIHsgc2hvd1Jlc2V0OiB0cnVlIH1cbiAgICApO1xuXG4gICAgLy8gU2luZ2xlLWxpbmUgaW5wdXQgbmV4dCB0byB0aGUgY29sb3IsIGxpa2UgdGhlIG9uZSBpbiB0aGUgVFlQLUxpc3QuIE5vXG4gICAgLy8gaGVhZGluZzogd2hpbGUgZW1wdHksIGl0cyBmYWRlZCBwbGFjZWhvbGRlciBzYXlzIHdoYXQgaXQgaXMuXG4gICAgY29uc3QgZGVzY0lucHV0ID0gb3B0aW9uc0hlYWRlci5jcmVhdGVFbChcImlucHV0XCIsIHtcbiAgICAgIHR5cGU6IFwidGV4dFwiLFxuICAgICAgY2xzOiBcInR5cC1kZXNjcmlwdGlvbi1pbnB1dFwiLFxuICAgICAgYXR0cjogeyBwbGFjZWhvbGRlcjogXCJEZXNjcmlwdGlvblwiIH0sXG4gICAgfSk7XG4gICAgZGVzY0lucHV0LnZhbHVlID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwRGVzY3JpcHRpb25zW3R5cF0gPz8gXCJcIjtcbiAgICBkZXNjSW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImNoYW5nZVwiLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCB2YWx1ZSA9IGRlc2NJbnB1dC52YWx1ZS50cmltKCk7XG4gICAgICBpZiAodmFsdWUpIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cERlc2NyaXB0aW9uc1t0eXBdID0gdmFsdWU7XG4gICAgICBlbHNlIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBEZXNjcmlwdGlvbnNbdHlwXTtcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgIH0pO1xuXG4gICAgLy8gU2VwYXJhdGVzIHRoZSBmcm9udG1hdHRlciBibG9ja3MgZnJvbSB0aGUgVFlQJ3Mgb3RoZXIgc2V0dGluZ3MuXG4gICAgYm9keS5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWRldGFpbC1zZXBhcmF0b3JcIiB9KTtcblxuICAgIC8vIFRZUC1Gcm9udG1hdHRlciBhbmQgb25lIGJsb2NrIHBlciByZWdpc3RlcmVkIFN1YnR5cCBiZWxvdywgZWFjaCB3aXRoIGl0c1xuICAgIC8vIG93biBlZGl0b3IgKHNlZSBmcm9udG1hdHRlci1ibG9ja3MuanMpLCBzbyB0aGUgc2FtZSBrZXkgbWF5IGFwcGVhciBpblxuICAgIC8vIHNldmVyYWwgYmxvY2tzLiBBIFN1YnR5cCBibG9jayBhZGRzIHRvIHRoZSBUWVAtRnJvbnRtYXR0ZXIgZm9yIG5vdGVzIHdpdGhcbiAgICAvLyB0aGF0IFNVQlRZUCBhbmQgb3ZlcnJpZGVzIHNhbWUtbmFtZWQgcHJvcGVydGllcyAoc2VlIHN1YnR5cHMuanMpLlxuICAgIGNvbnN0IGJ1Y2tldCA9IHRoaXMucGx1Z2luLnR5cEluZGV4LnN1YnR5cEJ1Y2tldCh0eXApO1xuICAgIHRoaXMuZnJvbnRtYXR0ZXJCbG9ja3MgPSBtb3VudEZyb250bWF0dGVyQmxvY2tzKHRoaXMsIGJvZHksIHR5cCwge1xuICAgICAgcmVuZGVySGVhZGVyOiAoc2VjdGlvbiwgZWwsIGJsb2NrcykgPT4gdGhpcy5yZW5kZXJTZWN0aW9uSGVhZGVyKGVsLCB0eXAsIHNlY3Rpb24sIGJ1Y2tldCwgYmxvY2tzKSxcbiAgICAgIHJlbmRlckZvb3RlcjogKHNlY3Rpb24sIGVsKSA9PiB7XG4gICAgICAgIGlmIChzZWN0aW9uICE9PSBudWxsKSB0aGlzLnJlbmRlclNlY3Rpb25Gb290ZXIoZWwsIHR5cCwgc2VjdGlvbik7XG4gICAgICB9LFxuICAgICAgb25Nb3ZlU2VjdGlvbjogYXN5bmMgKG9yZGVyKSA9PiB7XG4gICAgICAgIHJlb3JkZXJTdWJ0eXBzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXAsIG9yZGVyKTtcbiAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgICB9LFxuICAgIH0pO1xuICAgIHRoaXMuZnJvbnRtYXR0ZXJFZGl0b3JzLnB1c2goLi4udGhpcy5mcm9udG1hdHRlckJsb2Nrcy5lZGl0b3JzKTtcblxuICAgIC8vIEZ1bGwgd2lkdGggYW5kIGFjY2VudCBjb2xvciwgdG8gc3RhbmQgYXBhcnQgZnJvbSB0aGUgYmxvY2tzJyBzbWFsbCBpY29uXG4gICAgLy8gYnV0dG9ucy5cbiAgICB0aGlzLnN1YnR5cEFkZEJ0bkVsID0gYm9keS5jcmVhdGVFbChcImJ1dHRvblwiLCB7IGNsczogXCJtb2QtY3RhIHR5cC1zdWJ0eXAtYWRkXCIgfSk7XG4gICAgc2V0SWNvbih0aGlzLnN1YnR5cEFkZEJ0bkVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLXN1YnR5cC1hZGQtaWNvblwiIH0pLCBcInBsdXNcIik7XG4gICAgdGhpcy5zdWJ0eXBBZGRCdG5FbC5jcmVhdGVTcGFuKHsgdGV4dDogXCJBZGQgU3VidHlwXCIgfSk7XG4gICAgdGhpcy5zdWJ0eXBBZGRCdG5FbC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5zdGFydEFkZFN1YnR5cCh0eXApKTtcblxuICAgIHRoaXMucmVuZGVyVW5yZWdpc3RlcmVkU3VidHlwcyhib2R5LCB0eXAsIGJ1Y2tldCk7XG5cbiAgICBib2R5LmNyZWF0ZURpdih7IGNsczogXCJ0eXAtZGV0YWlsLXNlcGFyYXRvclwiIH0pO1xuICAgIHRoaXMucmVuZGVyRmxvYXRpbmdIaW50KGJvZHkpO1xuICAgIC8vIFRoZSBib2xkIG1hcmtzIChmcm9udG1hdHRlci1kZWZhdWx0LWhpZ2hsaWdodC5qcykgb25seSByZWFjdCB0byBtZXRhZGF0YVxuICAgIC8vIGFuZCBsYXlvdXQgZXZlbnRzOyBvcGVuaW5nIHRoaXMgdmlldyBmaXJlcyBub25lLCBzbyByZWZyZXNoIGhlcmUuIE9ubHlcbiAgICAvLyB0aGlzIG9uZSByZWZyZXNoLCBub3QgdGhlIGZ1bGwgcmVmcmVzaFR5cENvbG9ycygpLCB3aGljaCB3b3VsZCBjYWxsXG4gICAgLy8gcmVuZGVyKCkgb24gdGhpcyB2aWV3IHdoaWxlIGl0IGlzIHN0aWxsIHJlbmRlcmluZy5cbiAgICB0aGlzLnBsdWdpbi5yZWZyZXNoRnJvbnRtYXR0ZXJIaWdobGlnaHQ/LigpO1xuICB9XG5cbiAgLy8gQSBibG9jaydzIGhlYWRpbmcgKHNlZSBmcm9udG1hdHRlci1ibG9ja3MuanMpOiB0aXRsZSB3aXRoIG5vdGUgY291bnQgKGZvclxuICAvLyB0aGUgVFlQLUZyb250bWF0dGVyIHRoZSBub3RlcyB3aXRob3V0IFNVQlRZUCwgdGhlIG9ubHkgb25lcyBpdCBhcHBsaWVzIHRvXG4gIC8vIGFsb25lKSwgc2VhcmNoIG9uIGNsaWNrLCBhbmQgdGhlIHR3byBhZGQgYnV0dG9ucyBmb3IgYSBibGFuayByb3cgaW4gdGhpc1xuICAvLyBibG9jay5cbiAgcmVuZGVyU2VjdGlvbkhlYWRlcihlbCwgdHlwLCBzZWN0aW9uLCBidWNrZXQsIGJsb2Nrcykge1xuICAgIGNvbnN0IHRpdGxlR3JvdXAgPSBlbC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWZyb250bWF0dGVyLXRpdGxlLWdyb3VwXCIgfSk7XG4gICAgLy8gTmV2ZXIgY29sb3JlZCwgdW5saWtlIHRoZSBkZXRhaWwgdGl0bGUgYWJvdmU6IGEgYmxvY2sncyBjb2xvciBzaXRzIGluXG4gICAgLy8gaXRzIGZvb3RlciBkb3QgKHNlZSByZW5kZXJTZWN0aW9uRm9vdGVyKS5cbiAgICBjb25zdCB0aXRsZUVsID0gdGl0bGVHcm91cC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWRldGFpbC1zZWN0aW9uLXRpdGxlXCIsIHRleHQ6IHNlY3Rpb24gPz8gYCR7dHlwfS1Gcm9udG1hdHRlcmAgfSk7XG4gICAgY29uc3QgY291bnQgPSBzZWN0aW9uID09PSBudWxsID8gYnVja2V0Lm5vU3VidHlwIDogYnVja2V0LmNvdW50cy5nZXQoc2VjdGlvbikgPz8gMDtcbiAgICB0aXRsZUdyb3VwLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLXN1YnR5cC1jb3VudFwiLCB0ZXh0OiBTdHJpbmcoY291bnQpIH0pO1xuICAgIHRoaXMubWFrZVNlYXJjaGFibGUodGl0bGVFbCwgKCkgPT4gdGhpcy5vcGVuU3VidHlwU2VhcmNoKHR5cCwgc2VjdGlvbikpO1xuXG4gICAgLy8gRmxvYXRpbmcgcHJvcGVydGllcyBzaGFyZSB0aGUgbGlzdCBhbmQgb3JkZXIgb2YgdGhlIG90aGVycyAod2hpY2hcbiAgICAvLyBmcm9udG1hdHRlciBzb3J0aW5nIHJlbGllcyBvbiksIHNvIHRoZXkgbGFuZCB3aGVyZXZlciBkcmFnICYgZHJvcCBwdXRzXG4gICAgLy8gdGhlbSBpbnN0ZWFkIG9mIGF0IHRoZSBlbmQgb2YgYSBzZWNvbmQgbGlzdC5cbiAgICBjb25zdCBhZGRCdXR0b25zID0gZWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1mcm9udG1hdHRlci1hZGQtZ3JvdXBcIiB9KTtcblxuICAgIC8vIExlZnQgb2YgdGhlIHBsYWluIGJ1dHRvbiwgaW4gYWNjZW50IGNvbG9yOiBtYXJrcyB0aGUgbmV4dCBhZGRlZCAob3IsXG4gICAgLy8gdW50aWwgc2F2ZWQsIHJlbmFtZWQpIHByb3BlcnR5IGFzIGZsb2F0aW5nIChzZWVcbiAgICAvLyBlZGl0b3IudHlwUGVuZGluZ0Zsb2F0aW5nQWRkKS4gRmxvYXRpbmcgcHJvcGVydGllcyBhcmVuJ3QgY3JlYXRlZCBmb3IgbmV3XG4gICAgLy8gbm90ZXMgKHNlZSBnZXRUeXBEZWZhdWx0cygpKSBhbmQgc2hvdyBpbiBpdGFsaWNzIHdoZXJlIHByZXNlbnQuXG4gICAgY29uc3QgYWRkRmxvYXRpbmdQcm9wZXJ0eUJ0biA9IGFkZEJ1dHRvbnMuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJjbGlja2FibGUtaWNvbiB0eXAtZnJvbnRtYXR0ZXItYWRkLWZsb2F0aW5nXCIsXG4gICAgICBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIkFkZCBmbG9hdGluZyBwcm9wZXJ0eVwiIH0sXG4gICAgfSk7XG4gICAgc2V0SWNvbihhZGRGbG9hdGluZ1Byb3BlcnR5QnRuLCBcInBsdXNcIik7XG4gICAgYWRkRmxvYXRpbmdQcm9wZXJ0eUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gYmxvY2tzLmFkZEJsYW5rKHNlY3Rpb24sIHRydWUpKTtcblxuICAgIGNvbnN0IGFkZFByb3BlcnR5QnRuID0gYWRkQnV0dG9ucy5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImNsaWNrYWJsZS1pY29uIHR5cC1mcm9udG1hdHRlci1hZGRcIixcbiAgICAgIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiQWRkIHByb3BlcnR5XCIgfSxcbiAgICB9KTtcbiAgICBzZXRJY29uKGFkZFByb3BlcnR5QnRuLCBcInBsdXNcIik7XG4gICAgYWRkUHJvcGVydHlCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IGJsb2Nrcy5hZGRCbGFuayhzZWN0aW9uLCBmYWxzZSkpO1xuICB9XG5cbiAgLy8gRm9vdGVyIG9mIGEgU3VidHlwIGJsb2NrOiBvbiB0aGUgbGVmdCB0aGUgU3VidHlwIGNvbG9yIChhIGRvdCBvcGVuaW5nIHRoZVxuICAvLyBzbGlkZXJzLCByZXNldCBuZXh0IHRvIGl0KSwgb24gdGhlIHJpZ2h0IHRoZSBzYW1lIGFjdGlvbnMgaW4gdGhlIHNhbWUgb3JkZXJcbiAgLy8gYXMgdGhlIGRldGFpbCBoZWFkZXIgKHJlbmFtZSBhbmQgdXBkYXRlIG5vdGVzLCByZW5hbWUsIG1hbnVhbGx5IGNyZWF0YWJsZSxcbiAgLy8gZGVsZXRlKS4gVGhlIFRZUC1Gcm9udG1hdHRlciBoYXMgbm8gZm9vdGVyLiBUaGUgdGl0bGUgaXMgbG9va2VkIHVwIG9uXG4gIC8vIGNsaWNrIC0gaGVhZGluZyBhbmQgZm9vdGVyIGFyZSByZWJ1aWx0IG9uIGV2ZXJ5IHN5bmNocm9uaXplKCkuXG4gIHJlbmRlclNlY3Rpb25Gb290ZXIoZWwsIHR5cCwgc3VidHlwKSB7XG4gICAgZWwuYWRkQ2xhc3MoXCJ0eXAtc3VidHlwLWFjdGlvbnNcIik7XG4gICAgY29uc3QgY29sb3JHcm91cCA9IGVsLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtc3VidHlwLWNvbG9yLWdyb3VwXCIgfSk7XG4gICAgLy8gQSByaW5nIGFsc28gd2hpbGUgdGhlIFRZUCBpdHNlbGYgaGFzIG5vIGNvbG9yIC0gdGhlbiBhbiBvZmZzZXQgY29sb3JzXG4gICAgLy8gbm90aGluZyBhbnl3aGVyZS5cbiAgICBjb25zdCBvd25Db2xvciA9IHN1YnR5cEhhc093bkNvbG9yKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXAsIHN1YnR5cCk7XG4gICAgY29uc3QgdHlwSGFzQ29sb3IgPSAhIXRoaXMucGx1Z2luLnNldHRpbmdzLnR5cENvbG9yc1t0eXBdO1xuICAgIGNvbnN0IGNvbG9yRG90ID0gY29sb3JHcm91cC5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcInR5cC1zdWJ0eXAtY29sb3ItZG90XCIsXG4gICAgICBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiAhdHlwSGFzQ29sb3IgPyBcIlRZUCBoYXMgbm8gY29sb3JcIiA6IG93bkNvbG9yID8gXCJBZGp1c3QgY29sb3JcIiA6IFwiVXNlcyBUWVAgY29sb3JcIiB9LFxuICAgIH0pO1xuICAgIGNvbG9yRG90LnR5cFN1YnR5cCA9IHN1YnR5cDtcbiAgICBwYWludENvbG9yRG90KGNvbG9yRG90LCBzdWJ0eXBDb2xvcih0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwLCBzdWJ0eXApID8/IERFRkFVTFRfVFlQX0NPTE9SLCAhb3duQ29sb3IgfHwgIXR5cEhhc0NvbG9yKTtcbiAgICBjb2xvckRvdC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5vcGVuU3VidHlwQ29sb3JQb3BvdmVyKGNvbG9yRG90LCB0eXAsIHN1YnR5cCkpO1xuICAgIGNvbnN0IHJlc2V0QnRuID0gY29sb3JHcm91cC5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb24gdHlwLWNvbG9yLXJlc2V0XCIsIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiUmVzZXQgY29sb3JcIiB9IH0pO1xuICAgIHJlc2V0QnRuLnRvZ2dsZUNsYXNzKFwiaXMtZGlzYWJsZWRcIiwgIW93bkNvbG9yKTtcbiAgICBzZXRJY29uKHJlc2V0QnRuLCBcInJvdGF0ZS1jY3dcIik7XG4gICAgcmVzZXRCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGRhdGEgPSBnZXRTdWJ0eXAodGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCwgc3VidHlwKTtcbiAgICAgIGlmICghZGF0YT8uY29sb3IpIHJldHVybjtcbiAgICAgIGNvbnN0IHNuYXBzaG90ID0gc25hcHNob3RTZXR0aW5ncyh0aGlzLnBsdWdpbik7XG4gICAgICBkZWxldGUgZGF0YS5jb2xvcjtcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgb2ZmZXJVbmRvKHRoaXMucGx1Z2luLCBgQ29sb3Igb2YgU3VidHlwICR7c3VidHlwfSByZXNldC5gLCBzbmFwc2hvdCk7XG4gICAgICB0aGlzLnJlZnJlc2hPdGhlclZpZXdzKCk7XG4gICAgICB0aGlzLnJlbmRlcigpO1xuICAgIH0pO1xuXG4gICAgY29uc3QgYWN0aW9ucyA9IGVsLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtc3VidHlwLWFjdGlvbi1ncm91cFwiIH0pO1xuICAgIGNvbnN0IHRpdGxlRWwgPSAoKSA9PiB7XG4gICAgICBsZXQgc2libGluZyA9IGVsLnByZXZpb3VzRWxlbWVudFNpYmxpbmc7XG4gICAgICB3aGlsZSAoc2libGluZyAmJiAhc2libGluZy5oYXNDbGFzcyhcInR5cC1zZWN0aW9uLWhlYWRlclwiKSkgc2libGluZyA9IHNpYmxpbmcucHJldmlvdXNFbGVtZW50U2libGluZztcbiAgICAgIHJldHVybiBzaWJsaW5nPy5xdWVyeVNlbGVjdG9yKFwiLnR5cC1kZXRhaWwtc2VjdGlvbi10aXRsZVwiKSA/PyBudWxsO1xuICAgIH07XG4gICAgY29uc3QgcmVuYW1lID0gKHVwZGF0ZU5vdGVzKSA9PiB7XG4gICAgICBjb25zdCB0YXJnZXQgPSB0aXRsZUVsKCk7XG4gICAgICBpZiAodGFyZ2V0KSB0aGlzLnN0YXJ0U3VidHlwUmVuYW1lKHR5cCwgc3VidHlwLCB0YXJnZXQsIHsgdXBkYXRlTm90ZXMgfSk7XG4gICAgfTtcblxuICAgIGNvbnN0IHJlbmFtZVdpdGhOb3Rlc0J0biA9IGFjdGlvbnMuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJjbGlja2FibGUtaWNvbiB0eXAtZGV0YWlsLXJlbmFtZS1ub3Rlc1wiLFxuICAgICAgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJSZW5hbWUgYW5kIHVwZGF0ZSBub3Rlc1wiIH0sXG4gICAgfSk7XG4gICAgc2V0SWNvbihyZW5hbWVXaXRoTm90ZXNCdG4sIFwicGVuY2lsXCIpO1xuICAgIHJlbmFtZVdpdGhOb3Rlc0J0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gcmVuYW1lKHRydWUpKTtcblxuICAgIGNvbnN0IHJlbmFtZUJ0biA9IGFjdGlvbnMuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIHR5cC1kZXRhaWwtcmVuYW1lXCIsIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiUmVuYW1lXCIgfSB9KTtcbiAgICBzZXRJY29uKHJlbmFtZUJ0biwgXCJwZW5jaWxcIik7XG4gICAgcmVuYW1lQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiByZW5hbWUoZmFsc2UpKTtcblxuICAgIHRoaXMucmVuZGVyU3VidHlwTWFudWFsVG9nZ2xlKGFjdGlvbnMsIHR5cCwgc3VidHlwKTtcblxuICAgIGNvbnN0IGRlbGV0ZUJ0biA9IGFjdGlvbnMuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIHR5cC1kZXRhaWwtZGVsZXRlXCIsIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiRGVsZXRlXCIgfSB9KTtcbiAgICBzZXRJY29uKGRlbGV0ZUJ0biwgXCJ0cmFzaFwiKTtcbiAgICBkZWxldGVCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuZGVsZXRlU3VidHlwV2l0aENvbmZpcm0odHlwLCBzdWJ0eXApKTtcbiAgfVxuXG4gIC8vIFBvcG92ZXIgYmVsb3cgYSBTdWJ0eXAgYmxvY2sncyBkb3Q6IG9uZSBzbGlkZXIgcGVyIGNoYW5uZWwsIGxpbWl0ZWQgdG8gdGhlXG4gIC8vIHJhbmdlIGZyb20gdGhlIHNldHRpbmdzIChzZWUgdHlwLWNvbG9ycy5qcyksIGVhY2ggdHJhY2sgc2hvd2luZyB0aGUgY29sb3JzXG4gIC8vIGl0IGNhbiByZWFjaC4gRHJhZ2dpbmcgb25seSB1cGRhdGVzIHRoZSBkb3QgaGVyZTsgc2F2aW5nLCB1cGRhdGluZyB0aGVcbiAgLy8gb3RoZXIgdmlld3MgYW5kIHJlLXJlbmRlcmluZyB0aGlzIG9uZSBoYXBwZW4gb24gY2xvc2UgKGNsaWNrIG91dHNpZGUgb3JcbiAgLy8gRXNjYXBlKSwgYW5kIG9ubHkgaWYgdGhlIGNvbG9yIGNoYW5nZWQuXG4gIC8vXG4gIC8vIEEgU3VidHlwIGNvbG9yIGlzIGFuIG9mZnNldCBmcm9tIHRoZSBUWVAgY29sb3I6IHdoaWxlIHRoZSBUWVAgaGFzIG5vbmUsXG4gIC8vIHRoZXJlIGlzIG5vdGhpbmcgdG8gb2Zmc2V0LCBzbyB0aGUgcG9wb3ZlciBzYXlzIHNvIGFuZCB0aGUgc2xpZGVycyBhcmVcbiAgLy8gbG9ja2VkICh0aGUgZG90IHN0YXlzIGEgaG9sbG93IHJpbmcsIHNlZSByZW5kZXJTZWN0aW9uRm9vdGVyKS5cbiAgb3BlblN1YnR5cENvbG9yUG9wb3ZlcihhbmNob3JFbCwgdHlwLCBzdWJ0eXApIHtcbiAgICB0aGlzLmNsb3NlU3VidHlwQ29sb3JQb3BvdmVyPy4oKTtcbiAgICBjb25zdCB7IHNldHRpbmdzIH0gPSB0aGlzLnBsdWdpbjtcbiAgICBjb25zdCBkYXRhID0gZ2V0U3VidHlwKHNldHRpbmdzLCB0eXAsIHN1YnR5cCk7XG4gICAgaWYgKCFkYXRhKSByZXR1cm47XG4gICAgY29uc3QgdHlwSGFzQ29sb3IgPSAhIXNldHRpbmdzLnR5cENvbG9yc1t0eXBdO1xuICAgIGNvbnN0IHR5cENvbG9yID0gc2V0dGluZ3MudHlwQ29sb3JzW3R5cF0gPz8gREVGQVVMVF9UWVBfQ09MT1I7XG4gICAgLy8gV2l0aG91dCBhbiBvZmZzZXQgZXZlcnkgc2xpZGVyIHN0YXJ0cyBhdCAwOyBTVUJUWVBfQ09MT1JfQ0hBTk5FTFMgYWxvbmVcbiAgICAvLyBzYXlzIHdoaWNoIGV4aXN0LlxuICAgIGNvbnN0IG9mZnNldCA9IGNsYW1wZWRPZmZzZXQoc2V0dGluZ3MsIGRhdGEuY29sb3IpID8/IE9iamVjdC5mcm9tRW50cmllcyhTVUJUWVBfQ09MT1JfQ0hBTk5FTFMubWFwKCh7IGtleSB9KSA9PiBba2V5LCAwXSkpO1xuICAgIGNvbnN0IGRvYyA9IGFuY2hvckVsLmRvYztcbiAgICBjb25zdCBwb3BvdmVyID0gZG9jLmJvZHkuY3JlYXRlRGl2KHsgY2xzOiBcIm1lbnUgdHlwLXN1YnR5cC1jb2xvci1wb3BvdmVyXCIgfSk7XG4gICAgaWYgKCF0eXBIYXNDb2xvcikgcG9wb3Zlci5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLXN1YnR5cC1jb2xvci1oaW50XCIsIHRleHQ6IGBTZXQgYSBjb2xvciBmb3IgJHt0eXB9IGZpcnN0LmAgfSk7XG5cbiAgICBjb25zdCByb3dzID0gW107XG4gICAgY29uc3QgdXBkYXRlID0gKCkgPT4ge1xuICAgICAgY29uc3QgY29sb3IgPSBhcHBseUNvbG9yT2Zmc2V0KHR5cENvbG9yLCBvZmZzZXQpO1xuICAgICAgZm9yIChjb25zdCBlbCBvZiB0aGlzLmNvbnRlbnRFbC5xdWVyeVNlbGVjdG9yQWxsKFwiLnR5cC1zdWJ0eXAtY29sb3ItZG90XCIpKSB7XG4gICAgICAgIGlmIChlbC50eXBTdWJ0eXAgPT09IHN1YnR5cCkgcGFpbnRDb2xvckRvdChlbCwgY29sb3IsICFoYXNDb2xvck9mZnNldChvZmZzZXQpIHx8ICFzZXR0aW5ncy50eXBDb2xvcnNbdHlwXSk7XG4gICAgICB9XG4gICAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSByb3coKTtcbiAgICB9O1xuXG4gICAgZm9yIChjb25zdCB7IGtleSwgbGFiZWwsIHVuaXQgfSBvZiBTVUJUWVBfQ09MT1JfQ0hBTk5FTFMpIHtcbiAgICAgIGNvbnN0IFttaW4sIG1heF0gPSBjaGFubmVsQm91bmRzKHNldHRpbmdzLCBrZXkpO1xuICAgICAgY29uc3Qgcm93ID0gcG9wb3Zlci5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLXN1YnR5cC1jb2xvci1yb3dcIiB9KTtcbiAgICAgIHJvdy5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1zdWJ0eXAtY29sb3ItbGFiZWxcIiwgdGV4dDogbGFiZWwgfSk7XG4gICAgICBjb25zdCBpbnB1dCA9IHJvdy5jcmVhdGVFbChcImlucHV0XCIsIHsgdHlwZTogXCJyYW5nZVwiLCBjbHM6IFwic2xpZGVyIHR5cC1zdWJ0eXAtY29sb3Itc2xpZGVyXCIgfSk7XG4gICAgICBpbnB1dC5taW4gPSBTdHJpbmcobWluKTtcbiAgICAgIGlucHV0Lm1heCA9IFN0cmluZyhtYXgpO1xuICAgICAgaW5wdXQuc3RlcCA9IFwiMVwiO1xuICAgICAgaW5wdXQudmFsdWUgPSBTdHJpbmcob2Zmc2V0W2tleV0pO1xuICAgICAgaW5wdXQuZGlzYWJsZWQgPSBtaW4gPT09IG1heCB8fCAhdHlwSGFzQ29sb3I7XG4gICAgICBjb25zdCB2YWx1ZUVsID0gcm93LmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLXN1YnR5cC1jb2xvci12YWx1ZVwiIH0pO1xuICAgICAgaW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImlucHV0XCIsICgpID0+IHtcbiAgICAgICAgb2Zmc2V0W2tleV0gPSBOdW1iZXIoaW5wdXQudmFsdWUpO1xuICAgICAgICB1cGRhdGUoKTtcbiAgICAgIH0pO1xuICAgICAgcm93cy5wdXNoKCgpID0+IHtcbiAgICAgICAgY29uc3Qgc3RlcHMgPSA4O1xuICAgICAgICBjb25zdCBzdG9wcyA9IFtdO1xuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8PSBzdGVwczsgaSsrKSB7XG4gICAgICAgICAgc3RvcHMucHVzaChhcHBseUNvbG9yT2Zmc2V0KHR5cENvbG9yLCB7IC4uLm9mZnNldCwgW2tleV06IG1pbiArICgobWF4IC0gbWluKSAqIGkpIC8gc3RlcHMgfSkpO1xuICAgICAgICB9XG4gICAgICAgIGlucHV0LnN0eWxlLnNldFByb3BlcnR5KFwiLS10eXAtdHJhY2tcIiwgYGxpbmVhci1ncmFkaWVudCh0byByaWdodCwgJHtzdG9wcy5qb2luKFwiLCBcIil9KWApO1xuICAgICAgICB2YWx1ZUVsLnNldFRleHQoYCR7b2Zmc2V0W2tleV0gPiAwID8gXCIrXCIgOiBcIlwifSR7b2Zmc2V0W2tleV19JHt1bml0fWApO1xuICAgICAgfSk7XG4gICAgfVxuICAgIHVwZGF0ZSgpO1xuXG4gICAgLy8gQmVsb3cgdGhlIGRvdCwgYnV0IGluc2lkZSB0aGUgd2luZG93LlxuICAgIGNvbnN0IHJlY3QgPSBhbmNob3JFbC5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICBjb25zdCB3aW4gPSBkb2MuZGVmYXVsdFZpZXc7XG4gICAgY29uc3Qgd2lkdGggPSBwb3BvdmVyLm9mZnNldFdpZHRoO1xuICAgIGNvbnN0IGhlaWdodCA9IHBvcG92ZXIub2Zmc2V0SGVpZ2h0O1xuICAgIHBvcG92ZXIuc3R5bGUubGVmdCA9IGAke01hdGgubWF4KDgsIE1hdGgubWluKHJlY3QubGVmdCwgd2luLmlubmVyV2lkdGggLSB3aWR0aCAtIDgpKX1weGA7XG4gICAgcG9wb3Zlci5zdHlsZS50b3AgPSBgJHtyZWN0LmJvdHRvbSArIDYgKyBoZWlnaHQgPiB3aW4uaW5uZXJIZWlnaHQgLSA4ID8gcmVjdC50b3AgLSA2IC0gaGVpZ2h0IDogcmVjdC5ib3R0b20gKyA2fXB4YDtcblxuICAgIGNvbnN0IG9uUG9pbnRlckRvd24gPSAoZXZlbnQpID0+IHtcbiAgICAgIGlmICghcG9wb3Zlci5jb250YWlucyhldmVudC50YXJnZXQpKSBjbG9zZSgpO1xuICAgIH07XG4gICAgY29uc3Qgb25LZXlEb3duID0gKGV2ZW50KSA9PiB7XG4gICAgICBpZiAoZXZlbnQua2V5ICE9PSBcIkVzY2FwZVwiKSByZXR1cm47XG4gICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICBjbG9zZSgpO1xuICAgIH07XG4gICAgY29uc3QgY2xvc2UgPSBhc3luYyAoKSA9PiB7XG4gICAgICB0aGlzLmNsb3NlU3VidHlwQ29sb3JQb3BvdmVyID0gbnVsbDtcbiAgICAgIGRvYy5yZW1vdmVFdmVudExpc3RlbmVyKFwibW91c2Vkb3duXCIsIG9uUG9pbnRlckRvd24sIHRydWUpO1xuICAgICAgZG9jLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIG9uS2V5RG93biwgdHJ1ZSk7XG4gICAgICBwb3BvdmVyLnJlbW92ZSgpO1xuICAgICAgY29uc3QgY3VycmVudCA9IGdldFN1YnR5cChzZXR0aW5ncywgdHlwLCBzdWJ0eXApO1xuICAgICAgaWYgKCFjdXJyZW50KSByZXR1cm47XG4gICAgICAvLyBVbmNoYW5nZWQgKGp1c3QgbG9va2VkLCBvciBzbGlkIGJhY2spOiBub3RoaW5nIHRvIHNhdmUsIGFuZCBub1xuICAgICAgLy8gcmUtcmVuZGVyIHRoYXQgY291bGQgbW92ZSBhbnl0aGluZy5cbiAgICAgIGNvbnN0IG5leHQgPSBoYXNDb2xvck9mZnNldChvZmZzZXQpID8geyAuLi5vZmZzZXQgfSA6IG51bGw7XG4gICAgICBpZiAoSlNPTi5zdHJpbmdpZnkobmV4dCkgPT09IEpTT04uc3RyaW5naWZ5KGN1cnJlbnQuY29sb3IgPz8gbnVsbCkpIHJldHVybjtcbiAgICAgIC8vIFRoZSBzbGlkZXJzIG9ubHkgdG91Y2hlZCB0aGUgZG90IHNvIGZhciwgc28gYSBzbmFwc2hvdCB0YWtlbiBub3cgaXNcbiAgICAgIC8vIHN0aWxsIHRoZSBzdGF0ZSBmcm9tIG9wZW5pbmcgLSB3aXRob3V0IHJldmVydGluZyBhbnl0aGluZyBzYXZlZFxuICAgICAgLy8gZWxzZXdoZXJlIGluIHRoZSBtZWFudGltZS5cbiAgICAgIGNvbnN0IHNuYXBzaG90ID0gc25hcHNob3RTZXR0aW5ncyh0aGlzLnBsdWdpbik7XG4gICAgICBpZiAobmV4dCkgY3VycmVudC5jb2xvciA9IG5leHQ7XG4gICAgICBlbHNlIGRlbGV0ZSBjdXJyZW50LmNvbG9yO1xuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICBvZmZlclVuZG8odGhpcy5wbHVnaW4sIGBDb2xvciBvZiBTdWJ0eXAgJHtzdWJ0eXB9IGNoYW5nZWQuYCwgc25hcHNob3QpO1xuICAgICAgdGhpcy5yZWZyZXNoT3RoZXJWaWV3cygpO1xuICAgICAgdGhpcy5yZW5kZXIoKTtcbiAgICB9O1xuICAgIHRoaXMuY2xvc2VTdWJ0eXBDb2xvclBvcG92ZXIgPSBjbG9zZTtcbiAgICBkb2MuYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNlZG93blwiLCBvblBvaW50ZXJEb3duLCB0cnVlKTtcbiAgICBkb2MuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgb25LZXlEb3duLCB0cnVlKTtcbiAgfVxuXG4gIC8vIERlbGV0ZXMgdGhlIFN1YnR5cCBibG9jayB3aXRoIGl0cyBwcm9wZXJ0aWVzLiBOb3RlcyBrZWVwIHRoZWlyIFNVQlRZUFxuICAvLyB2YWx1ZSAoaXQgdGhlbiBzaG93cyBhcyB1bnJlZ2lzdGVyZWQgYmVsb3cpLCBzbyBjb25maXJtYXRpb24gaXMgb25seVxuICAvLyBuZWVkZWQgd2hlbiBwcm9wZXJ0aWVzIHdvdWxkIGJlIGxvc3QuIEVpdGhlciB3YXkgYW4gdW5kbyBpcyBvZmZlcmVkXG4gIC8vIGFmdGVyd2FyZHMgKHNlZSB1bmRvLmpzKS5cbiAgZGVsZXRlU3VidHlwV2l0aENvbmZpcm0odHlwLCBzdWJ0eXApIHtcbiAgICBjb25zdCBhcHBseSA9IGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHNuYXBzaG90ID0gc25hcHNob3RTZXR0aW5ncyh0aGlzLnBsdWdpbik7XG4gICAgICBkZWxldGVTdWJ0eXAodGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCwgc3VidHlwKTtcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgb2ZmZXJVbmRvKHRoaXMucGx1Z2luLCBgU3VidHlwICR7c3VidHlwfSBkZWxldGVkLmAsIHNuYXBzaG90KTtcbiAgICAgIHRoaXMucmVmcmVzaE90aGVyVmlld3MoKTtcbiAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgfTtcbiAgICBjb25zdCBrZXlzID0gT2JqZWN0LmtleXMoZ2V0U3VidHlwKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXAsIHN1YnR5cCk/LmZyb250bWF0dGVyID8/IHt9KS5maWx0ZXIoKGtleSkgPT4ga2V5ICE9PSBcIlwiKTtcbiAgICBpZiAoa2V5cy5sZW5ndGggPT09IDApIHtcbiAgICAgIGFwcGx5KCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHsgcGx1Z2luIH0gPSB0aGlzO1xuICAgIHRoaXMuY29uZmlybURlbGV0aW9uKFxuICAgICAge1xuICAgICAgICB0aXRsZTogW1xuICAgICAgICAgIFwiRGVsZXRlIFwiLFxuICAgICAgICAgIHN1YnR5cE5hbWVOb2RlKHBsdWdpbiwgdHlwLCBzdWJ0eXApLFxuICAgICAgICAgIFwiIG9mIFwiLFxuICAgICAgICAgIHR5cE5hbWVOb2RlKHBsdWdpbiwgdHlwLCBwbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzW3R5cF0gPz8gbnVsbCksXG4gICAgICAgICAgXCI/XCIsXG4gICAgICAgIF0sXG4gICAgICAgIGJvZHk6IFtcbiAgICAgICAgICBrZXlzLmxlbmd0aCA9PT0gMVxuICAgICAgICAgICAgPyBgSXRzIHByb3BlcnR5ICR7a2V5c1swXX0gd2lsbCBiZSBsb3N0LmBcbiAgICAgICAgICAgIDogYEl0cyAke2tleXMubGVuZ3RofSBwcm9wZXJ0aWVzICR7a2V5cy5qb2luKFwiLCBcIil9IHdpbGwgYmUgbG9zdC5gLFxuICAgICAgICBdLFxuICAgICAgfSxcbiAgICAgIGFwcGx5XG4gICAgKTtcbiAgfVxuXG4gIC8vIFwiRGVsZXRlIFRZUFwiIGFuZCBcIkRlbGV0ZSBTdWJ0eXBcIiBjaGFuZ2Ugbm90aGluZyBidXQgdGhlIHNldHRpbmdzIGFuZCBvZmZlclxuICAvLyBVbmRvIGFmdGVyd2FyZHMsIHNvIC0gdW5saWtlIGV2ZXJ5IGRpYWxvZyB0aGF0IHJld3JpdGVzIG5vdGVzIC0gdGhlaXJcbiAgLy8gY29uZmlybWF0aW9uIGNhbiBiZSBzd2l0Y2hlZCBvZmY6IHNldHRpbmcgXCJDb25maXJtIGRlbGV0aW9uXCIsIG9yIFwiRG9uJ3RcbiAgLy8gYXNrIGFnYWluXCIgaW4gdGhlIGRpYWxvZyBpdHNlbGYuIFdpdGhvdXQgaXQgYXBwbHkoKSBydW5zIGF0IG9uY2UuXG4gIGNvbmZpcm1EZWxldGlvbih7IHRpdGxlLCBib2R5IH0sIGFwcGx5KSB7XG4gICAgaWYgKCF0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb25maXJtRGVsZXRpb24pIHtcbiAgICAgIGFwcGx5KCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIG5ldyBDb25maXJtTW9kYWwodGhpcy5hcHAsIHtcbiAgICAgIHRpdGxlLFxuICAgICAgYm9keSxcbiAgICAgIGNvbmZpcm1UZXh0OiBcIkRlbGV0ZVwiLFxuICAgICAgd2FybmluZzogdHJ1ZSxcbiAgICAgIGZvY3VzOiBcImNhbmNlbFwiLFxuICAgICAgZG9udEFza0FnYWluOiB0cnVlLFxuICAgICAgb25Db25maXJtOiAoZG9udEFza0FnYWluKSA9PiB7XG4gICAgICAgIC8vIFNldCBiZWZvcmUgYXBwbHkoKSwgd2hpY2ggc2F2ZXMgaXQgYWxvbmcgd2l0aCB0aGUgZGVsZXRpb24gYW5kXG4gICAgICAgIC8vIHRha2VzIGl0cyB1bmRvIHNuYXBzaG90IG9ubHkgYWZ0ZXJ3YXJkcyAtIFVuZG8gZG9lc24ndCBicmluZyB0aGVcbiAgICAgICAgLy8gZGlhbG9nIGJhY2suXG4gICAgICAgIGlmIChkb250QXNrQWdhaW4pIHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbmZpcm1EZWxldGlvbiA9IGZhbHNlO1xuICAgICAgICBhcHBseSgpO1xuICAgICAgfSxcbiAgICB9KS5vcGVuKCk7XG4gIH1cblxuICAvLyBMaWtlIHN0YXJ0RGV0YWlsUmVuYW1lKCksIG9uIGEgU3VidHlwIGJsb2NrJ3MgdGl0bGUuIFRoZSBibG9jayBrZWVwcyBpdHNcbiAgLy8gcG9zaXRpb247IHVwZGF0ZU5vdGVzOiB0cnVlIGFsc28gcmV3cml0ZXMgdGhlIFNVQlRZUCBvZiB0aGUgYWZmZWN0ZWQgbm90ZXNcbiAgLy8gYWZ0ZXIgY29uZmlybWF0aW9uLiBBbiBleGlzdGluZyBuYW1lIG9mZmVycyBhIG1lcmdlIGluc3RlYWQgKHdoaWNoIGFsd2F5c1xuICAvLyByZXdyaXRlcyB0aGUgbm90ZXMpLlxuICBzdGFydFN1YnR5cFJlbmFtZSh0eXAsIHN1YnR5cCwgdGl0bGVFbCwgeyB1cGRhdGVOb3RlcyA9IGZhbHNlIH0gPSB7fSkge1xuICAgIHRoaXMuc3RhcnRJbmxpbmVFZGl0KHRpdGxlRWwsIHtcbiAgICAgIGNsYXNzZXM6IFtcInR5cC1zdWJ0eXAtbmFtZS1pbnB1dFwiLCBcImlzLWJlaW5nLXJlbmFtZWRcIl0sXG4gICAgICAvLyBUaGUgdGl0bGUgc2l0cyBhbW9uZyBPYnNpZGlhbidzIHByb3BlcnR5IGVkaXRvcnMsIHdob3NlIGtleWJvYXJkXG4gICAgICAvLyBuYXZpZ2F0aW9uIHdvdWxkIHJlYWN0IHRvby5cbiAgICAgIHN0b3BBbGxLZXlzOiB0cnVlLFxuICAgICAgb25GaW5pc2g6IChjb21taXQsIHRleHQpID0+XG4gICAgICAgIGNvbW1pdCA/IHRoaXMuY29tbWl0U3VidHlwUmVuYW1lKHR5cCwgc3VidHlwLCB0ZXh0LCB7IHVwZGF0ZU5vdGVzIH0pIDogdGhpcy5yZW5kZXIoKSxcbiAgICB9KTtcbiAgfVxuXG4gIGFzeW5jIGNvbW1pdFN1YnR5cFJlbmFtZSh0eXAsIHN1YnR5cCwgcmF3VGV4dCwgeyB1cGRhdGVOb3RlcyB9KSB7XG4gICAgY29uc3QgdmFsdWUgPSBub3JtYWxpemVTdWJ0eXBOYW1lKHJhd1RleHQpO1xuICAgIGlmICghdmFsdWUgfHwgdmFsdWUgPT09IHN1YnR5cCkge1xuICAgICAgdGhpcy5yZW5kZXIoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBjb3VudE9mID0gKG5hbWUpID0+IHRoaXMucGx1Z2luLnR5cEluZGV4LnN1YnR5cEJ1Y2tldCh0eXApLmNvdW50cy5nZXQobmFtZSkgPz8gMDtcbiAgICBjb25zdCBhcHBseVJlbmFtZSA9IGFzeW5jICh7IHdpdGhOb3RlcyB9KSA9PiB7XG4gICAgICByZW5hbWVTdWJ0eXAodGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCwgc3VidHlwLCB2YWx1ZSk7XG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgIGNvbnN0IHJlbmFtZWQgPSB3aXRoTm90ZXMgPyBhd2FpdCByZW5hbWVTdWJ0eXBJbk5vdGVzKHRoaXMucGx1Z2luLCB0eXAsIHN1YnR5cCwgdmFsdWUpIDogMDtcbiAgICAgIHRoaXMucmVmcmVzaE90aGVyVmlld3MoKTtcbiAgICAgIGlmICh3aXRoTm90ZXMpIG5ldyBOb3RpY2UoYFN1YnR5cCAke3ZhbHVlfTogJHtwbHVyYWwocmVuYW1lZCwgXCJub3RlXCIpfSB1cGRhdGVkLmApO1xuICAgICAgdGhpcy5yZW5kZXIoKTtcbiAgICB9O1xuXG4gICAgY29uc3QgZXhpc3RpbmcgPSBnZXRTdWJ0eXBOYW1lcyh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwKS5maW5kKFxuICAgICAgKG5hbWUpID0+IG5hbWUudG9Mb3dlckNhc2UoKSA9PT0gdmFsdWUudG9Mb3dlckNhc2UoKSAmJiBuYW1lICE9PSBzdWJ0eXBcbiAgICApO1xuICAgIGlmIChleGlzdGluZykge1xuICAgICAgbmV3IENvbmZpcm1Nb2RhbCh0aGlzLmFwcCwge1xuICAgICAgICB0aXRsZTogW1xuICAgICAgICAgIFwiTWVyZ2UgXCIsXG4gICAgICAgICAgc3VidHlwTmFtZU5vZGUodGhpcy5wbHVnaW4sIHR5cCwgc3VidHlwKSxcbiAgICAgICAgICBcIiBpbnRvIFwiLFxuICAgICAgICAgIHN1YnR5cE5hbWVOb2RlKHRoaXMucGx1Z2luLCB0eXAsIGV4aXN0aW5nKSxcbiAgICAgICAgICBcIj9cIixcbiAgICAgICAgXSxcbiAgICAgICAgYm9keTogW1xuICAgICAgICAgIGAke2V4aXN0aW5nfSBhbHJlYWR5IGV4aXN0cyBpbiAke3R5cH0uIGAgK1xuICAgICAgICAgICAgYCR7cGx1cmFsKGNvdW50T2Yoc3VidHlwKSwgXCJub3RlXCIpfSAke2NvdW50T2Yoc3VidHlwKSA9PT0gMSA/IFwibW92ZXNcIiA6IFwibW92ZVwifSB0byBpdCwgYCArXG4gICAgICAgICAgICBgYW5kIHRoZSBwcm9wZXJ0aWVzIG9mICR7c3VidHlwfSBtb3ZlIGludG8gaXRzIGJsb2NrLmAsXG4gICAgICAgIF0sXG4gICAgICAgIGNvbmZpcm1UZXh0OiBcIk1lcmdlXCIsXG4gICAgICAgIHdhcm5pbmc6IHRydWUsXG4gICAgICAgIGZvY3VzOiBcImNhbmNlbFwiLFxuICAgICAgICBvbkNvbmZpcm06IGFzeW5jICgpID0+IHtcbiAgICAgICAgICBtZXJnZVN1YnR5cHModGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCwgc3VidHlwLCBleGlzdGluZyk7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgY29uc3QgcmVuYW1lZCA9IGF3YWl0IHJlbmFtZVN1YnR5cEluTm90ZXModGhpcy5wbHVnaW4sIHR5cCwgc3VidHlwLCBleGlzdGluZyk7XG4gICAgICAgICAgdGhpcy5yZWZyZXNoT3RoZXJWaWV3cygpO1xuICAgICAgICAgIG5ldyBOb3RpY2UoYFN1YnR5cCAke3N1YnR5cH0gbWVyZ2VkIGludG8gJHtleGlzdGluZ30sICR7cGx1cmFsKHJlbmFtZWQsIFwibm90ZVwiKX0gdXBkYXRlZC5gKTtcbiAgICAgICAgICB0aGlzLnJlbmRlcigpO1xuICAgICAgICB9LFxuICAgICAgICBvbkNhbmNlbDogKCkgPT4gdGhpcy5yZW5kZXIoKSxcbiAgICAgIH0pLm9wZW4oKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoIXVwZGF0ZU5vdGVzKSB7XG4gICAgICBhd2FpdCBhcHBseVJlbmFtZSh7IHdpdGhOb3RlczogZmFsc2UgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIC8vIFNhbWUgY29sb3IgZm9yIG9sZCBhbmQgbmV3IG5hbWU6IHRoZSBuZXcgb25lIHRha2VzIG92ZXIgdGhlIG9sZCBvbmUnc1xuICAgIC8vIG9mZnNldCAoc2VlIHJlbmFtZVN1YnR5cCkuXG4gICAgbmV3IENvbmZpcm1Nb2RhbCh0aGlzLmFwcCwge1xuICAgICAgdGl0bGU6IFtcbiAgICAgICAgXCJSZW5hbWUgXCIsXG4gICAgICAgIHN1YnR5cE5hbWVOb2RlKHRoaXMucGx1Z2luLCB0eXAsIHN1YnR5cCksXG4gICAgICAgIFwiIHRvIFwiLFxuICAgICAgICBzdWJ0eXBOYW1lTm9kZSh0aGlzLnBsdWdpbiwgdHlwLCB2YWx1ZSwgc3VidHlwKSxcbiAgICAgICAgXCI/XCIsXG4gICAgICBdLFxuICAgICAgYm9keTogW2Ake3BsdXJhbChjb3VudE9mKHN1YnR5cCksIFwibm90ZVwiKX0gd2lsbCBiZSB1cGRhdGVkLmBdLFxuICAgICAgY29uZmlybVRleHQ6IFwiUmVuYW1lXCIsXG4gICAgICBmb2N1czogXCJjb25maXJtXCIsXG4gICAgICBvbkNvbmZpcm06ICgpID0+IGFwcGx5UmVuYW1lKHsgd2l0aE5vdGVzOiB0cnVlIH0pLFxuICAgICAgb25DYW5jZWw6ICgpID0+IHRoaXMucmVuZGVyKCksXG4gICAgfSkub3BlbigpO1xuICB9XG5cbiAgLy8gTGlrZSB0aGUgdW5yZWdpc3RlcmVkIGVudHJpZXMgb2YgdGhlIFRZUC1MaXN0OiBTVUJUWVAgdmFsdWVzIG9mIHRoaXMgVFlQJ3NcbiAgLy8gbm90ZXMgdGhhdCBoYXZlIG5vIGJsb2NrIHlldCAobm90ZXMgd2l0aG91dCBhbnkgU1VCVFlQIGNvdW50IGZvciB0aGVcbiAgLy8gVFlQLUZyb250bWF0dGVyIGluc3RlYWQpLiBTaG93biBsaWtlIFN1YnR5cCBibG9ja3MsIGJ1dCBvbmx5IGhlYWRpbmcgYW5kXG4gIC8vIGNvdW50LiBBIGNsaWNrIG9uIHRoZSBibG9jayByZWdpc3RlcnMgdGhlIHZhbHVlOyBhIGNsaWNrIG9uIHRoZSBuYW1lIG9wZW5zXG4gIC8vIHRoZSBzZWFyY2ggaW5zdGVhZCAtIGNoZWNraW5nIHdoYXQgYSB2YWx1ZSBob2xkcyBiZWZvcmUgcmVnaXN0ZXJpbmcgaXQgaXNcbiAgLy8gdGhlIGNvbW1vbiBjYXNlLiBUaGUgbmFtZSBsaWdodHMgdXAgaW4gYWNjZW50IGNvbG9yIG9uIGhvdmVyIHRvIHNob3cgaXRcbiAgLy8gZG9lcyBzb21ldGhpbmcgZGlmZmVyZW50IGZyb20gdGhlIGFyZWEgYXJvdW5kIGl0LlxuICByZW5kZXJVbnJlZ2lzdGVyZWRTdWJ0eXBzKHBhcmVudCwgdHlwLCBidWNrZXQpIHtcbiAgICBjb25zdCByZWdpc3RlcmVkID0gZ2V0U3VidHlwTmFtZXModGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCk7XG4gICAgY29uc3QgdW5yZWdpc3RlcmVkID0gWy4uLmJ1Y2tldC5jb3VudHMua2V5cygpXVxuICAgICAgLmZpbHRlcigoa2V5KSA9PiAhcmVnaXN0ZXJlZC5pbmNsdWRlcyhrZXkpKVxuICAgICAgLnNvcnQoKGEsIGIpID0+IGJ1Y2tldC5jb3VudHMuZ2V0KGIpIC0gYnVja2V0LmNvdW50cy5nZXQoYSkgfHwgYS5sb2NhbGVDb21wYXJlKGIpKTtcbiAgICBpZiAodW5yZWdpc3RlcmVkLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuXG4gICAgY29uc3QgbGlzdEVsID0gcGFyZW50LmNyZWF0ZURpdih7IGNsczogXCJ0eXAtc3VidHlwLXVucmVnaXN0ZXJlZC1saXN0XCIgfSk7XG4gICAgZm9yIChjb25zdCBrZXkgb2YgdW5yZWdpc3RlcmVkKSB7XG4gICAgICBjb25zdCBibG9jayA9IGxpc3RFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWZyb250bWF0dGVyLWJsb2NrIHR5cC1zdWJ0eXAtYmxvY2sgdHlwLXN1YnR5cC11bnJlZ2lzdGVyZWRcIiB9KTtcbiAgICAgIGNvbnN0IGhlYWRlciA9IGJsb2NrLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtZnJvbnRtYXR0ZXItaGVhZGVyXCIgfSk7XG4gICAgICBjb25zdCB0aXRsZUdyb3VwID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtZnJvbnRtYXR0ZXItdGl0bGUtZ3JvdXBcIiB9KTtcbiAgICAgIGNvbnN0IHRpdGxlRWwgPSB0aXRsZUdyb3VwLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtZGV0YWlsLXNlY3Rpb24tdGl0bGVcIiwgdGV4dDogZGlzcGxheVR5cEtleShrZXkpIH0pO1xuICAgICAgdGl0bGVHcm91cC5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1zdWJ0eXAtY291bnRcIiwgdGV4dDogU3RyaW5nKGJ1Y2tldC5jb3VudHMuZ2V0KGtleSkpIH0pO1xuICAgICAgYmxvY2suYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMucmVnaXN0ZXJTdWJ0eXAodHlwLCBrZXksIGJ1Y2tldCkpO1xuICAgICAgLy8gc3RvcFByb3BhZ2F0aW9uLCBvciB0aGUgc2FtZSBjbGljayB3b3VsZCBhbHNvIHJlZ2lzdGVyIHRoZSB2YWx1ZSBvbmVcbiAgICAgIC8vIG9ubHkgd2FudGVkIHRvIGxvb2sgdXAuXG4gICAgICB0aGlzLm1ha2VTZWFyY2hhYmxlKHRpdGxlRWwsICgpID0+IHRoaXMub3BlblN1YnR5cFNlYXJjaCh0eXAsIGtleSksIHsgc3RvcFByb3BhZ2F0aW9uOiB0cnVlIH0pO1xuICAgIH1cbiAgfVxuXG4gIC8vIEEgbmFtZSB3aG9zZSBjbGljayBvcGVucyB0aGUgc2VhcmNoOiBwb2ludGVyIGN1cnNvciBhbmQgYWNjZW50IGNvbG9yIG9uXG4gIC8vIGhvdmVyICgudHlwLXNlYXJjaGFibGUpLCBzbyB0aGUgdmlldyBpdHNlbGYgc2hvd3Mgd2hlcmUgc29tZXRoaW5nIGhhcHBlbnMuXG4gIC8vIFRoZSBuYW1lIGlzIHdoZXJlIG9uZSBleHBlY3RzIFwic2hvdyBtZSB0aGVzZSBub3Rlc1wiLiBXaGlsZSByZW5hbWluZywgdGhlXG4gIC8vIGVsZW1lbnQgaXMgYW4gaW5wdXQgKGlzLWJlaW5nLXJlbmFtZWQpIGFuZCBhIGNsaWNrIGp1c3QgcGxhY2VzIHRoZSBjdXJzb3IuXG4gIG1ha2VTZWFyY2hhYmxlKGVsLCBvblNlYXJjaCwgeyBzdG9wUHJvcGFnYXRpb24gPSBmYWxzZSB9ID0ge30pIHtcbiAgICBlbC5hZGRDbGFzcyhcInR5cC1zZWFyY2hhYmxlXCIpO1xuICAgIGVsLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZXZlbnQpID0+IHtcbiAgICAgIGlmIChlbC5oYXNDbGFzcyhcImlzLWJlaW5nLXJlbmFtZWRcIikpIHJldHVybjtcbiAgICAgIGlmIChzdG9wUHJvcGFnYXRpb24pIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgb25TZWFyY2goKTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIHN1YnR5cEtleSA9PT0gbnVsbCBtZWFucyBub3RlcyBvZiB0aGlzIFRZUCB3aXRob3V0IFNVQlRZUC4gQSBsaXN0IGhhcyBub1xuICAvLyBleGFjdCBzZWFyY2ggc3ludGF4IChhcyBpbiBvcGVuU2VhcmNoKCkpLCBzbyBpdCBzZWFyY2hlcyBub3RlcyBjYXJyeWluZyBhbGxcbiAgLy8gaXRzIGl0ZW1zLlxuICBvcGVuU3VidHlwU2VhcmNoKHR5cCwgc3VidHlwS2V5KSB7XG4gICAgY29uc3QgZ2xvYmFsU2VhcmNoID0gdGhpcy5wbHVnaW4uYXBwLmludGVybmFsUGx1Z2lucy5nZXRQbHVnaW5CeUlkKFwiZ2xvYmFsLXNlYXJjaFwiKTtcbiAgICBpZiAoIWdsb2JhbFNlYXJjaCkgcmV0dXJuO1xuICAgIGNvbnN0IHR5cENsYXVzZSA9IHRoaXMudHlwQ2xhdXNlKHR5cCk7XG4gICAgbGV0IHN1YnR5cENsYXVzZTtcbiAgICBpZiAoc3VidHlwS2V5ID09PSBudWxsKSB7XG4gICAgICBzdWJ0eXBDbGF1c2UgPSBgLVtcIiR7U1VCVFlQX1BST1BFUlRZfVwiXWA7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IHJhdyA9IHRoaXMucGx1Z2luLnR5cEluZGV4LnN1YnR5cEJ1Y2tldCh0eXApLnJhd0J5S2V5LmdldChzdWJ0eXBLZXkpO1xuICAgICAgc3VidHlwQ2xhdXNlID0gQXJyYXkuaXNBcnJheShyYXcpXG4gICAgICAgID8gcmF3Lm1hcCgodikgPT4gYFtcIiR7U1VCVFlQX1BST1BFUlRZfVwiOlwiJHtTdHJpbmcodiA/PyBcIlwiKS50cmltKCl9XCJdYCkuam9pbihcIiBcIilcbiAgICAgICAgOiBgW1wiJHtTVUJUWVBfUFJPUEVSVFl9XCI6XCIke3N1YnR5cEtleX1cIl1gO1xuICAgIH1cbiAgICBnbG9iYWxTZWFyY2guaW5zdGFuY2Uub3Blbkdsb2JhbFNlYXJjaChgJHt0eXBDbGF1c2V9ICR7c3VidHlwQ2xhdXNlfWApO1xuICB9XG5cbiAgLy8gTGlrZSByZWdpc3RlclR5cCgpOiByZWdpc3RlcnMgdGhlIGNsZWFuZWQgZm9ybSAodGl0bGUgY2FzZSwgYSBsaXN0IGFzIG9uZVxuICAvLyB2YWx1ZSBcIkEsIEJcIikgYXMgYSBTdWJ0eXAgb2YgdGhpcyBUWVAgYW5kIHJld3JpdGVzIHRoZSBTVUJUWVAgb2YgdGhlXG4gIC8vIGFmZmVjdGVkIG5vdGVzLiBJZiB0aGUgU3VidHlwIGV4aXN0cyBpbiBhbm90aGVyIHNwZWxsaW5nLCB0aGUgbm90ZXMgZ29cbiAgLy8gdGhlcmUuXG4gIGFzeW5jIHJlZ2lzdGVyU3VidHlwKHR5cCwgc3VidHlwS2V5LCBidWNrZXQpIHtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmFwcGx5U3VidHlwUmVnaXN0cmF0aW9uKHR5cCwgc3VidHlwS2V5LCBidWNrZXQpO1xuICAgIGlmICghcmVzdWx0KSByZXR1cm47XG5cbiAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICB0aGlzLnJlZnJlc2hPdGhlclZpZXdzKCk7XG4gICAgdGhpcy5yZW5kZXIoKTtcbiAgICBpZiAocmVzdWx0LnJlbmFtZWQgPiAwKSBuZXcgTm90aWNlKGBTdWJ0eXAgJHtyZXN1bHQuc3VidHlwfSByZWdpc3RlcmVkLCAke3BsdXJhbChyZXN1bHQucmVuYW1lZCwgXCJub3RlXCIpfSB1cGRhdGVkLmApO1xuICB9XG5cbiAgLy8gTGlrZSBhcHBseVR5cFJlZ2lzdHJhdGlvbjogdGhlIGNvcmUgd2l0aG91dCBzYXZpbmcgYW5kIG5vdGljZSwgc29cbiAgLy8gcmVnaXN0ZXJUeXBXaXRoU3VidHlwKCkgY2FuIGJ1bmRsZSBpdC4gUmV0dXJucyB7IHN1YnR5cCwgcmVuYW1lZCB9IG9yIG51bGwuXG4gIGFzeW5jIGFwcGx5U3VidHlwUmVnaXN0cmF0aW9uKHR5cCwgc3VidHlwS2V5LCBidWNrZXQpIHtcbiAgICBjb25zdCByYXcgPSBidWNrZXQucmF3QnlLZXkuZ2V0KHN1YnR5cEtleSk7XG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IG5vcm1hbGl6ZVJhd1R5cChyYXcgPT09IHVuZGVmaW5lZCA/IHN1YnR5cEtleSA6IHJhdywgbm9ybWFsaXplU3VidHlwTmFtZSk7XG4gICAgaWYgKCFub3JtYWxpemVkKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBleGlzdGluZyA9IGdldFN1YnR5cE5hbWVzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXApLmZpbmQoKG5hbWUpID0+IG5hbWUudG9Mb3dlckNhc2UoKSA9PT0gbm9ybWFsaXplZC50b0xvd2VyQ2FzZSgpKTtcbiAgICBjb25zdCBzdWJ0eXAgPSBleGlzdGluZyA/PyBub3JtYWxpemVkO1xuICAgIGVuc3VyZVN1YnR5cCh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwLCBzdWJ0eXApO1xuXG4gICAgY29uc3QgcmVuYW1lZCA9IHN1YnR5cCAhPT0gc3VidHlwS2V5ID8gYXdhaXQgcmVuYW1lU3VidHlwSW5Ob3Rlcyh0aGlzLnBsdWdpbiwgdHlwLCBzdWJ0eXBLZXksIHN1YnR5cCkgOiAwO1xuICAgIHJldHVybiB7IHN1YnR5cCwgcmVuYW1lZCB9O1xuICB9XG5cbiAgLy8gQSBuZXcsIGVtcHR5IFN1YnR5cCBibG9jayByaWdodCBhYm92ZSB0aGUgXCJBZGQgU3VidHlwXCIgYnV0dG9uLCBpdHMgbmFtZVxuICAvLyB0eXBlZCBpbmxpbmUgKGxpa2Ugc3RhcnRBZGQoKSBpbiB0aGUgbGlzdCkuXG4gIHN0YXJ0QWRkU3VidHlwKHR5cCkge1xuICAgIGlmICh0aGlzLmlzRWRpdGluZyB8fCAhdGhpcy5zdWJ0eXBBZGRCdG5FbCkgcmV0dXJuO1xuXG4gICAgLy8gQnVpbHQgbGlrZSB0aGUgZmluaXNoZWQgKGVtcHR5KSBibG9jaywgd2l0aCB0aGUgXCIrXCIgYnV0dG9ucyBhbmQgZm9vdGVyXG4gICAgLy8gYWN0aW9ucyB0aGF0IGRvIG5vdGhpbmcgeWV0LCBqdXN0IHdpdGhvdXQgYSBjb3VudCAtIHNvIG5vdGhpbmcganVtcHNcbiAgICAvLyB3aGVuIHRoZSBpbnB1dCBpcyBkb25lIChzZWUgLnR5cC1zdWJ0eXAtcGVuZGluZykuXG4gICAgY29uc3QgYmxvY2sgPSBjcmVhdGVEaXYoeyBjbHM6IFwidHlwLWZyb250bWF0dGVyLWJsb2NrIHR5cC1zdWJ0eXAtYmxvY2sgdHlwLXN1YnR5cC1wZW5kaW5nXCIgfSk7XG4gICAgdGhpcy5zdWJ0eXBBZGRCdG5FbC5wYXJlbnRFbGVtZW50Lmluc2VydEJlZm9yZShibG9jaywgdGhpcy5zdWJ0eXBBZGRCdG5FbCk7XG4gICAgY29uc3QgaGVhZGVyID0gYmxvY2suY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1mcm9udG1hdHRlci1oZWFkZXJcIiB9KTtcbiAgICBjb25zdCB0aXRsZUdyb3VwID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtZnJvbnRtYXR0ZXItdGl0bGUtZ3JvdXBcIiB9KTtcbiAgICBjb25zdCBuYW1lRWwgPSB0aXRsZUdyb3VwLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtZGV0YWlsLXNlY3Rpb24tdGl0bGUgdHlwLXN1YnR5cC1uYW1lLWlucHV0IGlzLWJlaW5nLXJlbmFtZWRcIiB9KTtcbiAgICBjb25zdCBhZGRCdXR0b25zID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtZnJvbnRtYXR0ZXItYWRkLWdyb3VwXCIgfSk7XG4gICAgc2V0SWNvbihhZGRCdXR0b25zLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiB0eXAtZnJvbnRtYXR0ZXItYWRkLWZsb2F0aW5nXCIgfSksIFwicGx1c1wiKTtcbiAgICBzZXRJY29uKGFkZEJ1dHRvbnMuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIHR5cC1mcm9udG1hdHRlci1hZGRcIiB9KSwgXCJwbHVzXCIpO1xuICAgIGNvbnN0IGZvb3RlciA9IGJsb2NrLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtc2VjdGlvbi1mb290ZXIgdHlwLXN1YnR5cC1hY3Rpb25zXCIgfSk7XG4gICAgY29uc3QgY29sb3JHcm91cCA9IGZvb3Rlci5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLXN1YnR5cC1jb2xvci1ncm91cFwiIH0pO1xuICAgIHBhaW50Q29sb3JEb3QoY29sb3JHcm91cC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLXN1YnR5cC1jb2xvci1kb3RcIiB9KSwgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzW3R5cF0gPz8gREVGQVVMVF9UWVBfQ09MT1IsIHRydWUpO1xuICAgIHNldEljb24oY29sb3JHcm91cC5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb24gdHlwLWNvbG9yLXJlc2V0IGlzLWRpc2FibGVkXCIgfSksIFwicm90YXRlLWNjd1wiKTtcbiAgICBjb25zdCBhY3Rpb25zID0gZm9vdGVyLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtc3VidHlwLWFjdGlvbi1ncm91cFwiIH0pO1xuICAgIHNldEljb24oYWN0aW9ucy5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb24gdHlwLWRldGFpbC1yZW5hbWUtbm90ZXNcIiB9KSwgXCJwZW5jaWxcIik7XG4gICAgc2V0SWNvbihhY3Rpb25zLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiB0eXAtZGV0YWlsLXJlbmFtZVwiIH0pLCBcInBlbmNpbFwiKTtcbiAgICAvLyBUaGUgc3RhdGUgZW5zdXJlU3VidHlwIHdpbGwgZ2l2ZSB0aGUgbmV3IFN1YnR5cDogdGhhdCBvZiBpdHMgVFlQLlxuICAgIGNvbnN0IG1hbnVhbENscyA9IFwiY2xpY2thYmxlLWljb24gdHlwLW1hbnVhbC1pY29uXCIgKyAodGhpcy5lbnN1cmVUeXBNYW51YWwoKVt0eXBdICE9PSBmYWxzZSA/IFwiIGlzLWFjdGl2ZVwiIDogXCJcIik7XG4gICAgc2V0SWNvbihhY3Rpb25zLmNyZWF0ZURpdih7IGNsczogbWFudWFsQ2xzIH0pLCBcImZpbGUtcGVuLWxpbmVcIik7XG4gICAgc2V0SWNvbihhY3Rpb25zLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiB0eXAtZGV0YWlsLWRlbGV0ZVwiIH0pLCBcInRyYXNoXCIpO1xuXG4gICAgdGhpcy5zdGFydElubGluZUVkaXQobmFtZUVsLCB7XG4gICAgICAvLyBuYW1lRWwgY2FycmllcyB0aGUgaW5wdXQgY2xhc3NlcyBmcm9tIHRoZSBzdGFydC5cbiAgICAgIGNsYXNzZXM6IFtdLFxuICAgICAgb25GaW5pc2g6IGFzeW5jIChjb21taXQsIHRleHQpID0+IHtcbiAgICAgICAgY29uc3QgdmFsdWUgPSBub3JtYWxpemVTdWJ0eXBOYW1lKHRleHQpO1xuICAgICAgICBpZiAoY29tbWl0ICYmIHZhbHVlKSB7XG4gICAgICAgICAgY29uc3QgZXhpc3RpbmcgPSBnZXRTdWJ0eXBOYW1lcyh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwKS5maW5kKChuYW1lKSA9PiBuYW1lLnRvTG93ZXJDYXNlKCkgPT09IHZhbHVlLnRvTG93ZXJDYXNlKCkpO1xuICAgICAgICAgIGlmIChleGlzdGluZykge1xuICAgICAgICAgICAgbmV3IE5vdGljZShgJHt0eXB9IGFscmVhZHkgaGFzIFN1YnR5cCAke2V4aXN0aW5nfS5gKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZW5zdXJlU3VidHlwKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXAsIHZhbHVlKTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICB0aGlzLnJlbmRlcigpO1xuICAgICAgfSxcbiAgICB9KTtcbiAgfVxuXG4gIC8vIE5vdGVzIGtlZXAgdGhlaXIgVFlQIChpdCB0aGVuIHNob3dzIGFzIHVucmVnaXN0ZXJlZCksIHNvIHRoaXMgb25seSBjaGFuZ2VzXG4gIC8vIHNldHRpbmdzOiBVbmRvIGFmdGVyd2FyZHMsIGFuZCB0aGUgY29uZmlybWF0aW9uIGNhbiBiZSBzd2l0Y2hlZCBvZmYgKHNlZVxuICAvLyBjb25maXJtRGVsZXRpb24pLiBGcm9tIHRoZSBkZXRhaWwgaGVhZGVyIG9yIHRoZSBsaXN0J3MgY29udGV4dCBtZW51LlxuICBzaG93RGVsZXRlQ29uZmlybSh0eXApIHtcbiAgICBjb25zdCBhcHBseSA9IGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHNuYXBzaG90ID0gc25hcHNob3RTZXR0aW5ncyh0aGlzLnBsdWdpbik7XG4gICAgICBkZWxldGVUeXBTZXR0aW5ncyh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwKTtcbiAgICAgIC8vIEJhY2sgdG8gdGhlIGxpc3QgKG9yIHRoZSBsaXN0IHJlYnVpbHQpIHJpZ2h0IGF3YXksIHNvIHRoZSBkZWxldGVkXG4gICAgICAvLyBUWVAncyBub3cgZW1wdHkgZGV0YWlsIHZpZXcgbmV2ZXIgc2hvd3MuXG4gICAgICBpZiAodGhpcy5zZWxlY3RlZFR5cCA9PT0gdHlwKSB0aGlzLmNsb3NlVHlwU2V0dGluZ3MoKTtcbiAgICAgIGVsc2UgdGhpcy5yZW5kZXIoKTtcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgb2ZmZXJVbmRvKHRoaXMucGx1Z2luLCBgVFlQICR7dHlwfSBkZWxldGVkLmAsIHNuYXBzaG90KTtcbiAgICAgIHRoaXMucmVmcmVzaE90aGVyVmlld3MoKTtcbiAgICB9O1xuICAgIHRoaXMuY29uZmlybURlbGV0aW9uKFxuICAgICAgeyB0aXRsZTogW1wiRGVsZXRlIFwiLCB0eXBOYW1lTm9kZSh0aGlzLnBsdWdpbiwgdHlwLCB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBDb2xvcnNbdHlwXSA/PyBudWxsKSwgXCI/XCJdIH0sXG4gICAgICBhcHBseVxuICAgICk7XG4gIH1cblxuICAvLyBcIlJlbmFtZVwiIC8gXCJSZW5hbWUgYW5kIHVwZGF0ZSBub3Rlc1wiIGZyb20gdGhlIGxpc3QncyBjb250ZXh0IG1lbnU6IHRoZVxuICAvLyBuYW1lIGluIHRoZSByb3cgYmVjb21lcyB0aGUgaW5wdXQsIHRoZSByZXN0IGlzIHRoZSBzYW1lIGFzIGluIHRoZSBkZXRhaWxcbiAgLy8gdmlldyAoY29tbWl0VHlwUmVuYW1lKS5cbiAgc3RhcnRMaXN0UmVuYW1lKHR5cCwgc2VsZiwgbmFtZUVsLCBvcHRpb25zID0ge30pIHtcbiAgICBpZiAodGhpcy5pc0VkaXRpbmcpIHJldHVybjtcbiAgICAvLyBBIGRyYWdnYWJsZSByb3cgKG1hbnVhbCBzb3J0aW5nKSB3b3VsZCB0YWtlIHRoZSBtb3VzZSBhd2F5IGZyb20gdGhlXG4gICAgLy8gdGV4dCAtIG5vIGN1cnNvciBwbGFjZW1lbnQgb3Igc2VsZWN0aW9uIGluIHRoZSBuYW1lLiByZW5kZXIoKSByZWJ1aWxkc1xuICAgIC8vIHRoZSByb3cgYWZ0ZXJ3YXJkcy5cbiAgICBzZWxmLmRyYWdnYWJsZSA9IGZhbHNlO1xuICAgIHRoaXMuc3RhcnRJbmxpbmVFZGl0KG5hbWVFbCwge1xuICAgICAgY2xhc3NFbDogc2VsZixcbiAgICAgIG9uRmluaXNoOiAoY29tbWl0LCB0ZXh0KSA9PiAoY29tbWl0ID8gdGhpcy5jb21taXRUeXBSZW5hbWUodHlwLCB0ZXh0LCBvcHRpb25zKSA6IHRoaXMucmVuZGVyKCkpLFxuICAgIH0pO1xuICB9XG5cbiAgLy8gVGhlIHJlbmFtZSBidXR0b25zIG9mIHRoZSBkZXRhaWwgaGVhZGVyLCBvbiB0aGUgdGl0bGUuXG4gIHN0YXJ0RGV0YWlsUmVuYW1lKHR5cCwgdGl0bGVFbCwgb3B0aW9ucyA9IHt9KSB7XG4gICAgdGhpcy5zdGFydElubGluZUVkaXQodGl0bGVFbCwge1xuICAgICAgb25GaW5pc2g6IChjb21taXQsIHRleHQpID0+IChjb21taXQgPyB0aGlzLmNvbW1pdFR5cFJlbmFtZSh0eXAsIHRleHQsIG9wdGlvbnMpIDogdGhpcy5yZW5kZXIoKSksXG4gICAgfSk7XG4gIH1cblxuICAvLyBUaGUgcmVuYW1lIGl0c2VsZiwgc2hhcmVkIGJ5IGxpc3QgYW5kIGRldGFpbCB2aWV3LiB1cGRhdGVOb3RlczogdHJ1ZSAodGhlXG4gIC8vIGhpZ2hsaWdodGVkIGJ1dHRvbikgYWxzbyByZXdyaXRlcyB0aGUgVFlQIG9mIGV2ZXJ5IGFmZmVjdGVkIG5vdGUgYWZ0ZXJcbiAgLy8gY29uZmlybWF0aW9uIChzZWUgcmVuYW1lVHlwSW5Ob3RlcykgaW5zdGVhZCBvZiBvbmx5IHRoZSBzZXR0aW5ncy4gQW5cbiAgLy8gZXhpc3RpbmcgbmFtZSBvZmZlcnMgYSBtZXJnZSAoc2hvd01lcmdlQ29uZmlybSkuXG4gIGFzeW5jIGNvbW1pdFR5cFJlbmFtZSh0eXAsIHJhd1RleHQsIHsgdXBkYXRlTm90ZXMgPSBmYWxzZSB9ID0ge30pIHtcbiAgICBjb25zdCB2YWx1ZSA9IG5vcm1hbGl6ZVR5cE5hbWUocmF3VGV4dCk7XG4gICAgaWYgKCF2YWx1ZSB8fCB2YWx1ZSA9PT0gdHlwKSB7XG4gICAgICB0aGlzLnJlbmRlcigpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwcy5maW5kKCh0KSA9PiB0LnRvTG93ZXJDYXNlKCkgPT09IHZhbHVlLnRvTG93ZXJDYXNlKCkgJiYgdCAhPT0gdHlwKTtcbiAgICBpZiAoZXhpc3RpbmcpIHtcbiAgICAgIHRoaXMuc2hvd01lcmdlQ29uZmlybSh0eXAsIGV4aXN0aW5nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoIXVwZGF0ZU5vdGVzKSB7XG4gICAgICBhd2FpdCB0aGlzLnJlbmFtZVR5cFNldHRpbmdzKHR5cCwgdmFsdWUpO1xuICAgICAgdGhpcy5yZW5kZXIoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBBIGJ1bGsgd3JpdGUgYWNyb3NzIHBvc3NpYmx5IG1hbnkgZmlsZXMgLSBjb25maXJtIGZpcnN0LiBTYW1lIGNvbG9yIGZvclxuICAgIC8vIG9sZCBhbmQgbmV3IG5hbWU6IHRoZSBuZXcgb25lIGhhcyBubyB0eXBDb2xvcnMgZW50cnkgeWV0IGJ1dCB0YWtlcyBvdmVyXG4gICAgLy8gdGhlIG9sZCBvbmUncyAoc2VlIHJlbmFtZVR5cFNldHRpbmdzKS5cbiAgICBjb25zdCB7IGNvdW50cyB9ID0gdGhpcy5wbHVnaW4udHlwSW5kZXgudHlwQ291bnRzKCk7XG4gICAgY29uc3QgY29sb3IgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBDb2xvcnNbdHlwXSA/PyBudWxsO1xuICAgIG5ldyBDb25maXJtTW9kYWwodGhpcy5hcHAsIHtcbiAgICAgIHRpdGxlOiBbXCJSZW5hbWUgXCIsIHR5cE5hbWVOb2RlKHRoaXMucGx1Z2luLCB0eXAsIGNvbG9yKSwgXCIgdG8gXCIsIHR5cE5hbWVOb2RlKHRoaXMucGx1Z2luLCB2YWx1ZSwgY29sb3IpLCBcIj9cIl0sXG4gICAgICBib2R5OiBbYCR7cGx1cmFsKGNvdW50cy5nZXQodHlwKSA/PyAwLCBcIm5vdGVcIil9IHdpbGwgYmUgdXBkYXRlZC5gXSxcbiAgICAgIGNvbmZpcm1UZXh0OiBcIlJlbmFtZVwiLFxuICAgICAgZm9jdXM6IFwiY29uZmlybVwiLFxuICAgICAgb25Db25maXJtOiBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IHRoaXMucmVuYW1lVHlwU2V0dGluZ3ModHlwLCB2YWx1ZSk7XG4gICAgICAgIGNvbnN0IHJlbmFtZWQgPSBhd2FpdCByZW5hbWVUeXBJbk5vdGVzKHRoaXMucGx1Z2luLCB0eXAsIHZhbHVlKTtcbiAgICAgICAgbmV3IE5vdGljZShgVFlQICR7dmFsdWV9OiAke3BsdXJhbChyZW5hbWVkLCBcIm5vdGVcIil9IHVwZGF0ZWQuYCk7XG4gICAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgICB9LFxuICAgICAgb25DYW5jZWw6ICgpID0+IHRoaXMucmVuZGVyKCksXG4gICAgfSkub3BlbigpO1xuICB9XG5cbiAgLy8gTW92ZXMgb25seSB0aGUgc2V0dGluZ3MgKGxpc3QgcG9zaXRpb24sIGNvbG9yLCBkZXNjcmlwdGlvbixcbiAgLy8gVFlQLUZyb250bWF0dGVyLCBtYW51YWwgdG9nZ2xlLCBTdWJ0eXBzIC0gc2VlIHR5cC1zZXR0aW5ncy5qcykgdG8gdGhlIG5ld1xuICAvLyBuYW1lOyB0b3VjaGVzIG5vIG5vdGVzLiBBbiBvcGVuIGRldGFpbCB2aWV3IGZvbGxvd3MgdGhlIG5ldyBuYW1lLCBhXG4gIC8vIHJlbmFtZSBmcm9tIHRoZSBsaXN0IHN0YXlzIGluIHRoZSBsaXN0LlxuICBhc3luYyByZW5hbWVUeXBTZXR0aW5ncyh0eXAsIHZhbHVlKSB7XG4gICAgbW92ZVR5cFNldHRpbmdzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXAsIHZhbHVlKTtcbiAgICBpZiAodGhpcy5zZWxlY3RlZFR5cCA9PT0gdHlwKSB0aGlzLnNlbGVjdGVkVHlwID0gdmFsdWU7XG4gICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgdGhpcy5yZWZyZXNoT3RoZXJWaWV3cygpO1xuICB9XG5cbiAgLy8gUmVuYW1pbmcgdG8gdGhlIG5hbWUgb2YgYW4gYWxyZWFkeSByZWdpc3RlcmVkIFRZUCAoc2VlIGNvbW1pdFR5cFJlbmFtZSlcbiAgLy8gb2ZmZXJzIHRvIG1lcmdlIGJvdGggKHNlZSBtZXJnZVR5cCkgaW5zdGVhZCBvZiBzaWxlbnRseSBkcm9wcGluZyB0aGVcbiAgLy8gcmVuYW1lLiBJdCBhbHdheXMgcmV3cml0ZXMgdGhlIG5vdGVzLCB3aGljaGV2ZXIgcmVuYW1lIGJ1dHRvbiBzdGFydGVkIGl0OlxuICAvLyBhIG1lcmdlIGluIHRoZSBzZXR0aW5ncyBvbmx5IHdvdWxkIGxlYXZlIHRoZSBzb3VyY2UgVFlQJ3Mgbm90ZXMgYXMgYW5cbiAgLy8gdW5yZWdpc3RlcmVkIGVudHJ5LlxuICBzaG93TWVyZ2VDb25maXJtKHNvdXJjZSwgdGFyZ2V0KSB7XG4gICAgY29uc3QgeyBzZXR0aW5ncyB9ID0gdGhpcy5wbHVnaW47XG4gICAgY29uc3QgY291bnQgPSB0aGlzLnBsdWdpbi50eXBJbmRleC50eXBDb3VudHMoKS5jb3VudHMuZ2V0KHNvdXJjZSkgPz8gMDtcbiAgICBuZXcgQ29uZmlybU1vZGFsKHRoaXMuYXBwLCB7XG4gICAgICB0aXRsZTogW1xuICAgICAgICBcIk1lcmdlIFwiLFxuICAgICAgICB0eXBOYW1lTm9kZSh0aGlzLnBsdWdpbiwgc291cmNlLCBzZXR0aW5ncy50eXBDb2xvcnNbc291cmNlXSA/PyBudWxsKSxcbiAgICAgICAgXCIgaW50byBcIixcbiAgICAgICAgdHlwTmFtZU5vZGUodGhpcy5wbHVnaW4sIHRhcmdldCwgc2V0dGluZ3MudHlwQ29sb3JzW3RhcmdldF0gPz8gbnVsbCksXG4gICAgICAgIFwiP1wiLFxuICAgICAgXSxcbiAgICAgIGJvZHk6IFtcbiAgICAgICAgYCR7dGFyZ2V0fSBhbHJlYWR5IGV4aXN0cy4gJHtwbHVyYWwoY291bnQsIFwibm90ZVwiKX0gJHtjb3VudCA9PT0gMSA/IFwibW92ZXNcIiA6IFwibW92ZVwifSB0byBpdC4gYCArXG4gICAgICAgICAgYFRoZSBjb2xvciwgZGVzY3JpcHRpb24gYW5kIFRZUC1Gcm9udG1hdHRlciBvZiAke3NvdXJjZX0gYXJlIGRyb3BwZWQuIGAgK1xuICAgICAgICAgIGBFdmVyeSBTdWJ0eXAgbW92ZXMgYWxvbmc7IGJsb2NrcyB3aXRoIHRoZSBzYW1lIG5hbWUgYXJlIG1lcmdlZC5gLFxuICAgICAgXSxcbiAgICAgIGNvbmZpcm1UZXh0OiBcIk1lcmdlXCIsXG4gICAgICB3YXJuaW5nOiB0cnVlLFxuICAgICAgZm9jdXM6IFwiY2FuY2VsXCIsXG4gICAgICBvbkNvbmZpcm06ICgpID0+IHRoaXMubWVyZ2VUeXAoc291cmNlLCB0YXJnZXQpLFxuICAgICAgb25DYW5jZWw6ICgpID0+IHRoaXMucmVuZGVyKCksXG4gICAgfSkub3BlbigpO1xuICB9XG5cbiAgLy8gTWVyZ2VzIHNvdXJjZSBpbnRvIHRhcmdldDogbm90ZXMgYXJlIHJld3JpdHRlbiB0byB0YXJnZXQsIHNvdXJjZSBsZWF2ZXNcbiAgLy8gdGhlIGxpc3Qgd2l0aCBpdHMgc2V0dGluZ3MgKHRhcmdldCBrZWVwcyBpdHMgb3duKS4gU291cmNlJ3MgU3VidHlwcyBtb3ZlXG4gIC8vIG92ZXIgZmlyc3QsIHNhbWUtbmFtZWQgYmxvY2tzIGFyZSBjb21iaW5lZCAoc2VlIG1lcmdlVHlwU3VidHlwcyBpblxuICAvLyBzdWJ0eXBzLmpzKTsgdGhlbiB0aGUgcmVzdCBvZiBzb3VyY2UgZ29lcyBsaWtlIGEgZGVsZXRlZCBUWVAuXG4gIC8vXG4gIC8vIFwiTWFudWFsbHkgY3JlYXRhYmxlXCIgaXMgd2hlcmUgYSBtZXJnZSBkb2VzIG1vcmUgdGhhbiBtb3ZlIGRhdGE6IHRoZSBtb3ZlZFxuICAvLyBTdWJ0eXBzIGJyaW5nIHNvdXJjZSdzIHRvZ2dsZXMgYnV0IGVuZCB1cCB1bmRlciB0YXJnZXQncy4gV2l0aCBzb3VyY2Ugb25cbiAgLy8gYW5kIHRhcmdldCBvZmYgdGhleSB3b3VsZCBiZSBzd2l0Y2hlZC1vbiBTdWJ0eXBzIHVuZGVyIGEgc3dpdGNoZWQtb2ZmIFRZUCxcbiAgLy8gdW5yZWFjaGFibGUgaW4gdGhlIHBpY2tlci4gU28gYSBzd2l0Y2hlZC1vZmYgdGFyZ2V0IHN3aXRjaGVzIHRoZW0gb2ZmIHRvbyxcbiAgLy8gYXMgaXRzIG93biBidXR0b24gd291bGQgKHNlZSByZW5kZXJNYW51YWxUb2dnbGUpLiBXaXRoIHRhcmdldCBvbiB0aGV5IHN0YXlcbiAgLy8gYXMgdGhleSB3ZXJlLlxuICAvL1xuICAvLyBBbiBvcGVuIGRldGFpbCB2aWV3IG9mIHNvdXJjZSBtb3ZlcyB0byB0YXJnZXQ7IGEgbWVyZ2Ugc3RhcnRlZCBmcm9tIHRoZVxuICAvLyBsaXN0IHN0YXlzIGluIHRoZSBsaXN0LlxuICBhc3luYyBtZXJnZVR5cChzb3VyY2UsIHRhcmdldCkge1xuICAgIGNvbnN0IHNldHRpbmdzID0gdGhpcy5wbHVnaW4uc2V0dGluZ3M7XG4gICAgY29uc3QgcmVuYW1lZCA9IGF3YWl0IHJlbmFtZVR5cEluTm90ZXModGhpcy5wbHVnaW4sIHNvdXJjZSwgdGFyZ2V0KTtcblxuICAgIG1lcmdlVHlwU3VidHlwcyhzZXR0aW5ncywgc291cmNlLCB0YXJnZXQpO1xuICAgIGRlbGV0ZVR5cFNldHRpbmdzKHNldHRpbmdzLCBzb3VyY2UpO1xuICAgIGlmICh0aGlzLmVuc3VyZVR5cE1hbnVhbCgpW3RhcmdldF0gPT09IGZhbHNlKSBzZXRBbGxTdWJ0eXBzTWFudWFsKHNldHRpbmdzLCB0YXJnZXQsIGZhbHNlKTtcblxuICAgIGlmICh0aGlzLnNlbGVjdGVkVHlwID09PSBzb3VyY2UpIHRoaXMuc2VsZWN0ZWRUeXAgPSB0YXJnZXQ7XG4gICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgdGhpcy5yZWZyZXNoT3RoZXJWaWV3cygpO1xuICAgIG5ldyBOb3RpY2UoYFRZUCAke3NvdXJjZX0gbWVyZ2VkIGludG8gJHt0YXJnZXR9LCAke3BsdXJhbChyZW5hbWVkLCBcIm5vdGVcIil9IHVwZGF0ZWQuYCk7XG4gICAgdGhpcy5yZW5kZXIoKTtcbiAgfVxuXG4gIHJlbmRlckNvdW50RmxhaXIoc2VsZiwgY291bnQpIHtcbiAgICBjb25zdCBmbGFpck91dGVyID0gc2VsZi5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtLWZsYWlyLW91dGVyXCIgfSk7XG4gICAgZmxhaXJPdXRlci5jcmVhdGVTcGFuKHsgY2xzOiBcInRyZWUtaXRlbS1mbGFpclwiLCB0ZXh0OiBTdHJpbmcoY291bnQpIH0pO1xuICB9XG5cbiAgLy8gRXhwbGFpbnMgdGhlIGZsb2F0aW5nIHRvZ2dsZSAocmlnaHQtY2xpY2sgb24gYSBwcm9wZXJ0eSBhYm92ZSwgc2VlXG4gIC8vIGVuc3VyZVByb3BlcnR5TWVudVBhdGNoKS4gTm8gaGVhZGluZyAtIHJpZ2h0IGJlbG93IHRoZSBsaXN0IGl0IGlzIGNsZWFyXG4gIC8vIHdoYXQgaXQgcmVmZXJzIHRvLlxuICByZW5kZXJGbG9hdGluZ0hpbnQocGFyZW50KSB7XG4gICAgY29uc3Qgc2VjdGlvbiA9IHBhcmVudC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWZsb2F0aW5nLWhpbnQtc2VjdGlvblwiIH0pO1xuICAgIHNlY3Rpb24uY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJ0eXAtZmxvYXRpbmctaGludFwiLFxuICAgICAgdGV4dDogXCJSaWdodC1jbGljayBhIHByb3BlcnR5IHRvIG1ha2UgaXQgZmxvYXRpbmcuXCIsXG4gICAgfSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gcmVnaXN0ZXJUeXBQYW5lKHBsdWdpbikge1xuICBwbHVnaW4ucmVnaXN0ZXJWaWV3KFZJRVdfVFlQRV9UWVBfUEFORSwgKGxlYWYpID0+IG5ldyBUeXBQYW5lKGxlYWYsIHBsdWdpbikpO1xuXG4gIHBsdWdpbi5hZGRDb21tYW5kKHtcbiAgICBpZDogXCJvcGVuLXR5cC1wYW5lXCIsXG4gICAgbmFtZTogXCJPcGVuIFRZUC1QYW5lXCIsXG4gICAgY2FsbGJhY2s6ICgpID0+IGFjdGl2YXRlVHlwUGFuZShwbHVnaW4pLFxuICB9KTtcblxuICBwbHVnaW4uYWRkQ29tbWFuZCh7XG4gICAgaWQ6IFwiYWRkLXR5cC1wcm9wZXJ0eVwiLFxuICAgIG5hbWU6IFwiQWRkIFRZUC1Gcm9udG1hdHRlciBwcm9wZXJ0eVwiLFxuICAgIGNhbGxiYWNrOiAoKSA9PiBhZGRUeXBQcm9wZXJ0eUNvbW1hbmQocGx1Z2luKSxcbiAgfSk7XG5cbiAgLy8gT24gaG90IHJlbG9hZCB0aGUgb2xkIGxlYWYgb2JqZWN0IHN1cnZpdmVzIChvbmx5IG91ciBtb2R1bGUgcmVsb2FkcyksIGJ1dFxuICAvLyBcImluc3RhbmNlb2YgVHlwUGFuZVwiIGZhaWxzIGFnYWluc3QgdGhlIHJlbG9hZGVkIGNsYXNzLCBhbmQgZ2V0Vmlld1R5cGUoKVxuICAvLyBjb21lcyBmcm9tIGxlYWYudmlldyBhbG9uZS4gYGFwcGAgc3Vydml2ZXMgdW5jaGFuZ2VkLCBzbyB0aGUgbGVhZlxuICAvLyByZWZlcmVuY2UgaXMga2VwdCB0aGVyZS5cbiAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeSgoKSA9PiBvcGVuVHlwUGFuZU9uU3RhcnQocGx1Z2luKSk7XG5cbiAgLy8gZXhjZXB0VmlldzogdGhlIFRZUC1QYW5lIHRoYXQgbWFkZSB0aGUgY2hhbmdlIGFuZCB1cGRhdGVzIGl0c2VsZiAoc2VlXG4gIC8vIHJlZnJlc2hUeXBDb2xvcnNFeGNlcHQgaW4gbWFpbi5qcykuXG4gIGNvbnN0IHJlZnJlc2ggPSAoZXhjZXB0VmlldyA9IG51bGwpID0+IHtcbiAgICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFZJRVdfVFlQRV9UWVBfUEFORSkpIHtcbiAgICAgIGlmIChsZWFmLnZpZXcgPT09IGV4Y2VwdFZpZXcpIGNvbnRpbnVlO1xuICAgICAgLy8gcmVuZGVyKCkgZm9yIGEgdmlldyBvZiB0aGUgbW9kdWxlIGJlZm9yZSBhIGhvdCByZWxvYWQuXG4gICAgICBpZiAobGVhZi52aWV3Py5yZXF1ZXN0UmVuZGVyKSBsZWFmLnZpZXcucmVxdWVzdFJlbmRlcigpO1xuICAgICAgZWxzZSBsZWFmLnZpZXc/LnJlbmRlcj8uKCk7XG4gICAgfVxuICB9O1xuXG4gIC8vIEtlZXBzIHRoZSBjb3VudHMgY3VycmVudCBvbiBldmVyeSBUWVAtcmVsZXZhbnQgY2hhbmdlIGVsc2V3aGVyZSAobmV3IG9yXG4gIC8vIGRlbGV0ZWQgbm90ZSwgVFlQIG9yIFNVQlRZUCBjaGFuZ2VkKS4gVGhlIGluZGV4J3MgXCJjaGFuZ2VcIiBmaXJlcyBvbmx5IGZvclxuICAvLyB0aG9zZSwgbm90IG9uIGV2ZXJ5IGF1dG9zYXZlLiBEZWJvdW5jZWQgYW55d2F5IHNpbmNlIHJlbmRlcmluZyB0aGUgbGlzdCBpc1xuICAvLyByZWxhdGl2ZWx5IGNvc3RseTsgcmVzZXRUaW1lciBjb2xsZWN0cyBhIGJ1cnN0IChidWxrIGltcG9ydCkgaW50byBvbmUuXG4gIC8vIFdpdGhvdXQgdGhlIGV2ZW50J3MgYXJndW1lbnRzLCB3aGljaCBhcmVuJ3QgYSB2aWV3IHRvIGxlYXZlIG91dC5cbiAgY29uc3QgZGVib3VuY2VkUmVmcmVzaCA9IGRlYm91bmNlKCgpID0+IHJlZnJlc2goKSwgNTAwLCB0cnVlKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLnR5cEluZGV4Lm9uKFwiY2hhbmdlXCIsIGRlYm91bmNlZFJlZnJlc2gpKTtcbiAgLy8gVGhlIFwiRXhjbHVkZWQgZmlsZXNcIiBsaXN0IGNoYW5nZWQgKEhpZGUgRm9sZGVycyB0b2dnbGluZyBhIGZvbGRlciwgc2F5KS5cbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC52YXVsdC5vbihcImNvbmZpZy1jaGFuZ2VkXCIsIGRlYm91bmNlZFJlZnJlc2gpKTtcblxuICAvLyBBIFRlbXBsYXRlciBzY3JpcHQgYXBwZWFyZWQsIHZhbmlzaGVkIG9yIHdhcyByZW5hbWVkOiB0aGUgc2hvcnRjdXRcbiAgLy8gYnV0dG9ucyB1cGRhdGUgdGhlaXIgXCJzY3JpcHQgbm90IGZvdW5kXCIgd2FybmluZyAocmVmcmVzaFNob3J0Y3V0Q29udHJvbHMpLlxuICAvLyBUaGUgbGlzdCBpcyByZWFkIG9uY2UgdGhlIGxheW91dCBpcyByZWFkeSAtIG9ubHkgdGhlbiBkb2VzIHRoZSB3YXJuaW5nXG4gIC8vIHNob3cgYXQgYWxsIChzZWUgcmVuZGVyU2hvcnRjdXRDb250cm9scykuXG4gIGNvbnN0IG9mZlNjcmlwdHMgPSBwbHVnaW4uZ2V0U2hvcnRjdXRTY3JpcHRzPy5vbkNoYW5nZT8uKCgpID0+IHtcbiAgICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFZJRVdfVFlQRV9UWVBfUEFORSkpIGxlYWYudmlldz8ucmVmcmVzaFNob3J0Y3V0Q29udHJvbHM/LigpO1xuICB9KTtcbiAgaWYgKG9mZlNjcmlwdHMpIHBsdWdpbi5yZWdpc3RlcihvZmZTY3JpcHRzKTtcblxuICAvLyBGb3IgcGx1Z2luLnJlZnJlc2hUeXBDb2xvcnMoRXhjZXB0KTogcmUtcmVuZGVycyB0aGUgbGlzdCBvciB0aGUgZGV0YWlsXG4gIC8vIHZpZXcuXG4gIHJldHVybiByZWZyZXNoO1xufVxuXG4vLyBsb2NhbFN0b3JhZ2Uga2V5IChwZXIgdmF1bHQsIHNlZSBvcGVuVHlwUGFuZU9uU3RhcnQpLlxuY29uc3QgUEFORV9DUkVBVEVEX0tFWSA9IFwidHlwLXN5c3RlbS1wYW5lLWNyZWF0ZWRcIjtcblxuLy8gVGhlIGF1dG9tYXRpYyBjYWxsIG9uY2UgdGhlIGxheW91dCBpcyByZWFkeSwgb24gZXZlcnkgc3RhcnQgYW5kIGhvdCByZWxvYWQuXG4vLyBOb3JtYWxseSBpdCBvbmx5IHJlY29ubmVjdHMgYW4gZXhpc3RpbmcgbGVhZiBvcnBoYW5lZCBieSBob3QgcmVsb2FkXG4vLyAoY3JlYXRlSWZNaXNzaW5nOiBmYWxzZSksIHNvIGEgcGFuZSB0aGF0IHdhcyBjbG9zZWQgc3RheXMgY2xvc2VkLiBPbmx5IG9uIHRoZVxuLy8gdmVyeSBmaXJzdCBzdGFydCBpbiB0aGlzIHZhdWx0IChubyBkYXRhLmpzb24geWV0LCBwbHVnaW4uaXNGaXJzdFJ1bikgaXRcbi8vIGNyZWF0ZXMgdGhlIHBhbmUgaW4gdGhlIGxlZnQgc2lkZWJhciBhbmQgcmV2ZWFscyBpdCwgc28gYSBuZXcgdXNlciBmaW5kcyBpdFxuLy8gd2l0aG91dCBrbm93aW5nIHRoZSBjb21tYW5kLlxuLy8gXCJBbHJlYWR5IGNyZWF0ZWRcIiBpcyByZW1lbWJlcmVkIGluIHRoaXMgZGV2aWNlJ3MgbG9jYWxTdG9yYWdlIGZvciB0aGUgdmF1bHRcbi8vIChhcHAuc2F2ZUxvY2FsU3RvcmFnZSksIG5vdCBpbiBkYXRhLmpzb246IGRhdGEuanNvbiBpcyBzdGlsbCBtaXNzaW5nIHRoZW4sXG4vLyBzbyBhIGhvdCByZWxvYWQgd291bGQgb3RoZXJ3aXNlIG9wZW4gdGhlIHBhbmUgYWdhaW4uIFdyaXRpbmcgZGF0YS5qc29uIGp1c3Rcbi8vIGZvciB0aGlzIG1hcmtlciBjb3VsZCBsZXQgU3luYyBwdXQgZGVmYXVsdHMgb3ZlciB0aGUgcmVhbCBzZXR0aW5ncyBvbiBhXG4vLyBzZWNvbmQgZGV2aWNlIHdoZXJlIHRoZSBwbHVnaW4gYXJyaXZlcyBiZWZvcmUgaXRzIGRhdGEuanNvbi5cbmFzeW5jIGZ1bmN0aW9uIG9wZW5UeXBQYW5lT25TdGFydChwbHVnaW4pIHtcbiAgY29uc3QgYXBwID0gcGx1Z2luLmFwcDtcbiAgY29uc3QgZmlyc3RSdW4gPSBwbHVnaW4uaXNGaXJzdFJ1biAmJiAhYXBwLmxvYWRMb2NhbFN0b3JhZ2UoUEFORV9DUkVBVEVEX0tFWSk7XG4gIGF3YWl0IGFjdGl2YXRlVHlwUGFuZShwbHVnaW4sIGZpcnN0UnVuLCBmaXJzdFJ1bik7XG4gIGlmIChmaXJzdFJ1bikgYXBwLnNhdmVMb2NhbFN0b3JhZ2UoUEFORV9DUkVBVEVEX0tFWSwgdHJ1ZSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGFjdGl2YXRlVHlwUGFuZShwbHVnaW4sIHJldmVhbCA9IHRydWUsIGNyZWF0ZUlmTWlzc2luZyA9IHRydWUpIHtcbiAgY29uc3QgYXBwID0gcGx1Z2luLmFwcDtcbiAgY29uc3QgeyB3b3Jrc3BhY2UgfSA9IGFwcDtcblxuICBjb25zdCBjYW5kaWRhdGVzID0gW107XG4gIHdvcmtzcGFjZS5pdGVyYXRlQWxsTGVhdmVzKChsZWFmKSA9PiB7XG4gICAgaWYgKFxuICAgICAgbGVhZiA9PT0gYXBwLl9fdHlwU3lzdGVtTGVhZiB8fFxuICAgICAgKGxlYWYudmlldyAmJiBsZWFmLnZpZXcuZ2V0Vmlld1R5cGUoKSA9PT0gVklFV19UWVBFX1RZUF9QQU5FKVxuICAgICkge1xuICAgICAgY2FuZGlkYXRlcy5wdXNoKGxlYWYpO1xuICAgIH1cbiAgfSk7XG5cbiAgbGV0IGxlYWYgPSBjYW5kaWRhdGVzLnNoaWZ0KCkgPz8gbnVsbDtcbiAgZm9yIChjb25zdCBleHRyYSBvZiBjYW5kaWRhdGVzKSBleHRyYS5kZXRhY2goKTtcblxuICBpZiAoIWxlYWYpIHtcbiAgICBpZiAoIWNyZWF0ZUlmTWlzc2luZykgcmV0dXJuO1xuICAgIGxlYWYgPSB3b3Jrc3BhY2UuZ2V0TGVmdExlYWYoZmFsc2UpO1xuICAgIGF3YWl0IGxlYWYuc2V0Vmlld1N0YXRlKHsgdHlwZTogVklFV19UWVBFX1RZUF9QQU5FLCBhY3RpdmU6IHRydWUgfSk7XG4gIH0gZWxzZSBpZiAoIShsZWFmLnZpZXcgaW5zdGFuY2VvZiBUeXBQYW5lKSkge1xuICAgIC8vIGFjdGl2ZTogZmFsc2UgLSBqdXN0IHJlY29ubmVjdGluZy4gb25MYXlvdXRSZWFkeSBmaXJlcyBhdCBvbmNlIG9uY2UgdGhlXG4gICAgLy8gbGF5b3V0IGlzIHJlYWR5LCBzbyBhY3RpdmU6IHRydWUgd291bGQgc3RlYWwgZm9jdXMgb24gZXZlcnkgaG90IHJlbG9hZC5cbiAgICBhd2FpdCBsZWFmLnNldFZpZXdTdGF0ZSh7IHR5cGU6IFZJRVdfVFlQRV9UWVBfUEFORSwgYWN0aXZlOiBmYWxzZSB9KTtcbiAgfVxuXG4gIGFwcC5fX3R5cFN5c3RlbUxlYWYgPSBsZWFmO1xuICBpZiAocmV2ZWFsKSB3b3Jrc3BhY2UucmV2ZWFsTGVhZihsZWFmKTtcbn1cblxuLy8gUHJlZmVycyBhbiBvcGVuIFRZUC1QYW5lIGRldGFpbCAoZXhhY3RseSBsaWtlIGl0cyBcIitcIiBidXR0b24pOyBvdGhlcndpc2Vcbi8vIG9wZW5zIHRoZSBkZXRhaWwgdmlldyBmb3IgdGhlIGFjdGl2ZSBub3RlJ3MgVFlQIGFuZCBhZGRzIHRoZSBwcm9wZXJ0eSB0aGVyZS5cbi8vIFdpdGhvdXQgYW4gb3BlbiBub3RlIG9yIFRZUCwgYSBUWVAtUGFuZSBzaG93aW5nIGEgZGV0YWlsIHZpZXcgLSBldmVuXG4vLyB1bmZvY3VzZWQgLSBpcyB0aGUgZmFsbGJhY2suIFRoZSBiYXJlIGxpc3QgZG9lc24ndCBjb3VudDogaXQgaGFzIG5vIGVkaXRvclxuLy8gdG8gYWRkIHRvLlxuYXN5bmMgZnVuY3Rpb24gYWRkVHlwUHJvcGVydHlDb21tYW5kKHBsdWdpbikge1xuICBjb25zdCBhcHAgPSBwbHVnaW4uYXBwO1xuXG4gIGNvbnN0IGFjdGl2ZVR5cFBhbmUgPSBhcHAud29ya3NwYWNlLmdldEFjdGl2ZVZpZXdPZlR5cGUoVHlwUGFuZSk7XG4gIGlmIChhY3RpdmVUeXBQYW5lICYmIGFjdGl2ZVR5cFBhbmUuc2VsZWN0ZWRUeXAgIT09IG51bGwpIHtcbiAgICBhY3RpdmVUeXBQYW5lLmZyb250bWF0dGVyQmxvY2tzPy5hZGRCbGFuayhudWxsKTtcbiAgICByZXR1cm47XG4gIH1cblxuICBjb25zdCBmaWxlID0gYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVGaWxlKCk7XG4gIGNvbnN0IHR5cCA9IHBsdWdpbi50eXBJbmRleC50eXBPZihmaWxlKTtcbiAgaWYgKCF0eXApIHtcbiAgICBjb25zdCBvcGVuTGVhZiA9IGFwcC53b3Jrc3BhY2VcbiAgICAgIC5nZXRMZWF2ZXNPZlR5cGUoVklFV19UWVBFX1RZUF9QQU5FKVxuICAgICAgLmZpbmQoKGxlYWYpID0+IGxlYWYudmlldyBpbnN0YW5jZW9mIFR5cFBhbmUgJiYgbGVhZi52aWV3LnNlbGVjdGVkVHlwICE9PSBudWxsKTtcbiAgICBpZiAob3BlbkxlYWYpIHtcbiAgICAgIGF3YWl0IGFwcC53b3Jrc3BhY2UucmV2ZWFsTGVhZihvcGVuTGVhZik7XG4gICAgICBvcGVuTGVhZi52aWV3LmZyb250bWF0dGVyQmxvY2tzPy5hZGRCbGFuayhudWxsKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgbmV3IE5vdGljZShcbiAgICAgIGZpbGVcbiAgICAgICAgPyBcIlRoZSBhY3RpdmUgbm90ZSBoYXMgbm8gVFlQLCBhbmQgbm8gVFlQIGlzIG9wZW4gaW4gdGhlIFRZUC1QYW5lLlwiXG4gICAgICAgIDogXCJObyBub3RlIGlzIG9wZW4sIGFuZCBubyBUWVAgaXMgb3BlbiBpbiB0aGUgVFlQLVBhbmUuXCJcbiAgICApO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGF3YWl0IGFjdGl2YXRlVHlwUGFuZShwbHVnaW4pO1xuICBjb25zdCB2aWV3ID0gYXBwLl9fdHlwU3lzdGVtTGVhZj8udmlldztcbiAgaWYgKCEodmlldyBpbnN0YW5jZW9mIFR5cFBhbmUpKSByZXR1cm47XG4gIHZpZXcub3BlblR5cFNldHRpbmdzKHR5cCk7XG4gIHZpZXcuZnJvbnRtYXR0ZXJCbG9ja3M/LmFkZEJsYW5rKG51bGwpO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJUeXBQYW5lLCBWSUVXX1RZUEVfVFlQX1BBTkUsIGNvbXBhcmVUeXBzLCBzb3J0VHlwc0J5TW9kZSwgREVGQVVMVF9TT1JUX09SREVSLCBERUZBVUxUX1RZUF9DT0xPUiB9O1xuIiwgImNvbnN0IHsgVEZpbGUsIFRGb2xkZXIgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgY29sb3JGb3JGaWxlLCBzZXRJbmxpbmVDb2xvciB9ID0gcmVxdWlyZShcIi4vdHlwLWNvbG9yc1wiKTtcblxuY29uc3QgRklMRV9FWFBMT1JFUl9WSUVXX1RZUEUgPSBcImZpbGUtZXhwbG9yZXJcIjtcbmNvbnN0IEZPTERFUl9OT1RFU19QTFVHSU5fSUQgPSBcImZvbGRlci1ub3Rlc1wiO1xuXG4vLyBGb2xkZXIgTm90ZXMgc2hvd3MgYSBub3RlIGFzIGl0cyBmb2xkZXIgaW5zdGVhZCBvZiBhcyBpdHMgb3duIHJvdy4gSXQgaGFzIG5vXG4vLyBwdWJsaWMgQVBJIGZvciB0aGlzLCBzbyB0aGUgZmlsZSBuYW1lIGlzIHJlYnVpbHQgZnJvbSBpdHMgbGl2ZSBzZXR0aW5ncy5cbmZ1bmN0aW9uIGdldEZvbGRlck5vdGVGaWxlKHBsdWdpbiwgZm9sZGVyKSB7XG4gIGNvbnN0IGZvbGRlck5vdGVzID0gcGx1Z2luLmFwcC5wbHVnaW5zLnBsdWdpbnNbRk9MREVSX05PVEVTX1BMVUdJTl9JRF07XG4gIGNvbnN0IHNldHRpbmdzID0gZm9sZGVyTm90ZXM/LnNldHRpbmdzO1xuICBpZiAoIXNldHRpbmdzKSByZXR1cm4gbnVsbDtcblxuICBjb25zdCBmaWxlTmFtZSA9XG4gICAgKHNldHRpbmdzLmZvbGRlck5vdGVOYW1lIHx8IFwie3tmb2xkZXJfbmFtZX19XCIpLnJlcGxhY2UoXCJ7e2ZvbGRlcl9uYW1lfX1cIiwgZm9sZGVyLm5hbWUpICtcbiAgICAoc2V0dGluZ3MuZm9sZGVyTm90ZVR5cGUgfHwgXCIubWRcIik7XG4gIGNvbnN0IGRpclBhdGggPSBzZXR0aW5ncy5zdG9yYWdlTG9jYXRpb24gPT09IFwicGFyZW50Rm9sZGVyXCIgPyBmb2xkZXIucGFyZW50Py5wYXRoID8/IFwiXCIgOiBmb2xkZXIucGF0aDtcbiAgY29uc3QgcGF0aCA9IGRpclBhdGggPyBgJHtkaXJQYXRofS8ke2ZpbGVOYW1lfWAgOiBmaWxlTmFtZTtcblxuICBjb25zdCBmaWxlID0gcGx1Z2luLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgocGF0aCk7XG4gIHJldHVybiBmaWxlIGluc3RhbmNlb2YgVEZpbGUgPyBmaWxlIDogbnVsbDtcbn1cblxuZnVuY3Rpb24gYXBwbHlDb2xvclRvVGl0bGUocGx1Z2luLCB0aXRsZUVsLCBmaWxlKSB7XG4gIGNvbnN0IGNvbnRlbnRFbCA9IHRpdGxlRWwucXVlcnlTZWxlY3RvcihcIi5uYXYtZmlsZS10aXRsZS1jb250ZW50LCAubmF2LWZvbGRlci10aXRsZS1jb250ZW50XCIpO1xuICBpZiAoIWNvbnRlbnRFbCkgcmV0dXJuO1xuXG4gIGNvbnN0IGNvbG9yID0gcGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MuZmlsZUV4cGxvcmVyID8gY29sb3JGb3JGaWxlKHBsdWdpbiwgZmlsZSwgXCJmaWxlRXhwbG9yZXJcIikgOiBudWxsO1xuICBzZXRJbmxpbmVDb2xvcihjb250ZW50RWwsIGNvbG9yKTtcbn1cblxuZnVuY3Rpb24gYXBwbHlGaWxlRXhwbG9yZXJDb2xvcnMocGx1Z2luKSB7XG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoRklMRV9FWFBMT1JFUl9WSUVXX1RZUEUpKSB7XG4gICAgY29uc3QgZmlsZVRpdGxlRWxzID0gbGVhZi52aWV3LmNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3JBbGwoXCIubmF2LWZpbGUtdGl0bGVbZGF0YS1wYXRoXVwiKTtcbiAgICBmb3IgKGNvbnN0IHRpdGxlRWwgb2YgZmlsZVRpdGxlRWxzKSB7XG4gICAgICBjb25zdCBmaWxlID0gcGx1Z2luLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgodGl0bGVFbC5nZXRBdHRyaWJ1dGUoXCJkYXRhLXBhdGhcIikpO1xuICAgICAgYXBwbHlDb2xvclRvVGl0bGUocGx1Z2luLCB0aXRsZUVsLCBmaWxlIGluc3RhbmNlb2YgVEZpbGUgPyBmaWxlIDogbnVsbCk7XG4gICAgfVxuXG4gICAgY29uc3QgZm9sZGVyVGl0bGVFbHMgPSBsZWFmLnZpZXcuY29udGFpbmVyRWwucXVlcnlTZWxlY3RvckFsbChcIi5uYXYtZm9sZGVyLXRpdGxlW2RhdGEtcGF0aF1cIik7XG4gICAgZm9yIChjb25zdCB0aXRsZUVsIG9mIGZvbGRlclRpdGxlRWxzKSB7XG4gICAgICBjb25zdCBmb2xkZXIgPSBwbHVnaW4uYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aCh0aXRsZUVsLmdldEF0dHJpYnV0ZShcImRhdGEtcGF0aFwiKSk7XG4gICAgICBjb25zdCBub3RlRmlsZSA9IGZvbGRlciBpbnN0YW5jZW9mIFRGb2xkZXIgPyBnZXRGb2xkZXJOb3RlRmlsZShwbHVnaW4sIGZvbGRlcikgOiBudWxsO1xuICAgICAgYXBwbHlDb2xvclRvVGl0bGUocGx1Z2luLCB0aXRsZUVsLCBub3RlRmlsZSk7XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyRmlsZUV4cGxvcmVyQ29sb3JzKHBsdWdpbikge1xuICBjb25zdCByZWZyZXNoID0gKCkgPT4gYXBwbHlGaWxlRXhwbG9yZXJDb2xvcnMocGx1Z2luKTtcblxuICAvLyBUaGUgZXhwbG9yZXIgcmUtcmVuZGVycyByb3dzIHdoZW4gZm9sZGVycyBleHBhbmQgb3IgY29sbGFwc2UuXG4gIGNvbnN0IG9ic2VydmVyID0gbmV3IE11dGF0aW9uT2JzZXJ2ZXIocmVmcmVzaCk7XG4gIGNvbnN0IG9ic2VydmVFeHBsb3JlckxlYXZlcyA9ICgpID0+IHtcbiAgICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKEZJTEVfRVhQTE9SRVJfVklFV19UWVBFKSkge1xuICAgICAgb2JzZXJ2ZXIub2JzZXJ2ZShsZWFmLnZpZXcuY29udGFpbmVyRWwsIHsgY2hpbGRMaXN0OiB0cnVlLCBzdWJ0cmVlOiB0cnVlIH0pO1xuICAgIH1cbiAgfTtcbiAgcGx1Z2luLnJlZ2lzdGVyKCgpID0+IG9ic2VydmVyLmRpc2Nvbm5lY3QoKSk7XG5cbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLnR5cEluZGV4Lm9uKFwiY2hhbmdlXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC52YXVsdC5vbihcInJlbmFtZVwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KFxuICAgIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwibGF5b3V0LWNoYW5nZVwiLCAoKSA9PiB7XG4gICAgICBvYnNlcnZlRXhwbG9yZXJMZWF2ZXMoKTtcbiAgICAgIHJlZnJlc2goKTtcbiAgICB9KVxuICApO1xuXG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkoKCkgPT4ge1xuICAgIG9ic2VydmVFeHBsb3JlckxlYXZlcygpO1xuICAgIHJlZnJlc2goKTtcbiAgfSk7XG5cbiAgcmV0dXJuIHJlZnJlc2g7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlckZpbGVFeHBsb3JlckNvbG9ycyB9O1xuIiwgImNvbnN0IHsgY29sb3JGb3JGaWxlIH0gPSByZXF1aXJlKFwiLi90eXAtY29sb3JzXCIpO1xuXG5jb25zdCBHUkFQSF9WSUVXX1RZUEVTID0gW1wiZ3JhcGhcIiwgXCJsb2NhbGdyYXBoXCJdO1xuXG5mdW5jdGlvbiBoZXhUb0ludChoZXgpIHtcbiAgcmV0dXJuIHBhcnNlSW50KGhleC5yZXBsYWNlKFwiI1wiLCBcIlwiKSwgMTYpO1xufVxuXG4vLyBlbmdpbmUucmVuZGVyKCkgb25seSBjb25zdWx0cyBpdHMgZmlsZUZpbHRlciBvbmNlIGEgY29sb3IgZ3JvdXAgZXhpc3RzO1xuLy8gd2l0aG91dCBvbmUgZXZlcnkgZmlsZSBqdXN0IGdldHMgY29sb3I6dHJ1ZS4gU28gd2UgcGF0Y2ggcmVuZGVyZXIuc2V0RGF0YSxcbi8vIHJpZ2h0IGJlZm9yZSB0aGUgbm9kZSBkYXRhIHJlYWNoZXMgdGhlIFdlYkdMIHJlbmRlcmVyIC0gdGhlIHNhbWUgc3BvdCB0aGVcbi8vIGNvbW11bml0eSBwbHVnaW4gZ3JhcGgtbmVzdGVkLXRhZ3MgdXNlcy4gTm9kZXMgYWxyZWFkeSBjb2xvcmVkIGJ5IGEgY29sb3Jcbi8vIGdyb3VwIGFyZSBsZWZ0IGFsb25lLlxuZnVuY3Rpb24gcGF0Y2hSZW5kZXJlcihwbHVnaW4sIHJlbmRlcmVyKSB7XG4gIGlmIChyZW5kZXJlci5fX3R5cFN5c3RlbUNvbG9yUGF0Y2hlZCkgcmV0dXJuO1xuICByZW5kZXJlci5fX3R5cFN5c3RlbUNvbG9yUGF0Y2hlZCA9IHRydWU7XG5cbiAgY29uc3Qgb3JpZ2luYWwgPSByZW5kZXJlci5zZXREYXRhO1xuICByZW5kZXJlci5zZXREYXRhID0gZnVuY3Rpb24gKGRhdGEpIHtcbiAgICBmb3IgKGNvbnN0IHBhdGggaW4gZGF0YS5ub2Rlcykge1xuICAgICAgY29uc3Qgbm9kZSA9IGRhdGEubm9kZXNbcGF0aF07XG4gICAgICBpZiAobm9kZS5jb2xvcikgY29udGludWU7XG5cbiAgICAgIGlmIChub2RlLnR5cGUgPT09IFwidGFnXCIpIHtcbiAgICAgICAgLy8gT3duIHRhZyBjb2xvciBkaXNhYmxlZCAoMjAyNi0wOS0zMCk6IHRoZSBNaW5pbWFsIHRoZW1lJ3MgU3R5bGVcbiAgICAgICAgLy8gU2V0dGluZ3MgYWxyZWFkeSBjb3ZlciBpdCAoR3JhcGhzIFx1MjE5MiBUYWcgbm9kZSBjb2xvcikuXG4gICAgICAgIC8vIGlmIChwbHVnaW4uc2V0dGluZ3MuZ3JhcGhUYWdDb2xvckVuYWJsZWQgJiYgcGx1Z2luLnNldHRpbmdzLmdyYXBoVGFnQ29sb3IpIHtcbiAgICAgICAgLy8gICBub2RlLmNvbG9yID0geyBhOiAxLCByZ2I6IGhleFRvSW50KHBsdWdpbi5zZXR0aW5ncy5ncmFwaFRhZ0NvbG9yKSB9O1xuICAgICAgICAvLyB9XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBmaWxlID0gcGx1Z2luLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgocGF0aCk7XG4gICAgICBsZXQgY29sb3IgPSBudWxsO1xuXG4gICAgICBpZiAoZmlsZSAmJiBmaWxlLmV4dGVuc2lvbiAhPT0gXCJtZFwiKSB7XG4gICAgICAgIC8vIE93biBhdHRhY2htZW50IGNvbG9yIGRpc2FibGVkICgyMDI2LTA5LTMwKSwgc2VlIHRhZyBjb2xvciBhYm92ZVxuICAgICAgICAvLyAoR3JhcGhzIFx1MjE5MiBBdHRhY2htZW50IG5vZGUgY29sb3IpLlxuICAgICAgICAvLyBpZiAocGx1Z2luLnNldHRpbmdzLmdyYXBoQXR0YWNobWVudENvbG9yRW5hYmxlZCAmJiBwbHVnaW4uc2V0dGluZ3MuZ3JhcGhBdHRhY2htZW50Q29sb3IpIHtcbiAgICAgICAgLy8gICBjb2xvciA9IHBsdWdpbi5zZXR0aW5ncy5ncmFwaEF0dGFjaG1lbnRDb2xvcjtcbiAgICAgICAgLy8gfVxuICAgICAgfSBlbHNlIGlmIChwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5ncmFwaCkge1xuICAgICAgICBjb2xvciA9IGNvbG9yRm9yRmlsZShwbHVnaW4sIGZpbGUsIFwiZ3JhcGhcIik7XG4gICAgICB9XG5cbiAgICAgIGlmIChjb2xvcikgbm9kZS5jb2xvciA9IHsgYTogMSwgcmdiOiBoZXhUb0ludChjb2xvcikgfTtcbiAgICB9XG4gICAgcmV0dXJuIG9yaWdpbmFsLmNhbGwodGhpcywgZGF0YSk7XG4gIH07XG5cbiAgcGx1Z2luLnJlZ2lzdGVyKCgpID0+IHtcbiAgICByZW5kZXJlci5zZXREYXRhID0gb3JpZ2luYWw7XG4gICAgZGVsZXRlIHJlbmRlcmVyLl9fdHlwU3lzdGVtQ29sb3JQYXRjaGVkO1xuICB9KTtcbn1cblxuZnVuY3Rpb24gZ2V0R3JhcGhMZWF2ZXMoYXBwKSB7XG4gIGNvbnN0IGxlYXZlcyA9IFtdO1xuICBmb3IgKGNvbnN0IHZpZXdUeXBlIG9mIEdSQVBIX1ZJRVdfVFlQRVMpIGxlYXZlcy5wdXNoKC4uLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKHZpZXdUeXBlKSk7XG4gIHJldHVybiBsZWF2ZXM7XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyR3JhcGhDb2xvcnMocGx1Z2luKSB7XG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiB7XG4gICAgZm9yIChjb25zdCBsZWFmIG9mIGdldEdyYXBoTGVhdmVzKHBsdWdpbi5hcHApKSB7XG4gICAgICBpZiAobGVhZi52aWV3Py5yZW5kZXJlcikgcGF0Y2hSZW5kZXJlcihwbHVnaW4sIGxlYWYudmlldy5yZW5kZXJlcik7XG4gICAgICAvLyBUaGUgZ2xvYmFsIGdyYXBoIGtlZXBzIGl0cyBlbmdpbmUgaW4gdmlldy5kYXRhRW5naW5lLCB0aGUgbG9jYWwgb25lIGluXG4gICAgICAvLyB2aWV3LmVuZ2luZS5cbiAgICAgIChsZWFmLnZpZXc/LmRhdGFFbmdpbmUgPz8gbGVhZi52aWV3Py5lbmdpbmUpPy5yZW5kZXIoKTtcbiAgICB9XG4gIH07XG5cbiAgLy8gUmVnaXN0ZXJlZCBiZWZvcmUgYW55IHBhdGNoUmVuZGVyZXIoKSBjbGVhbnVwLCBzbyBpdCBydW5zIGFmdGVyIHRoZW0gb25cbiAgLy8gdW5sb2FkIChPYnNpZGlhbiBydW5zIHRoZXNlIGNhbGxiYWNrcyBsYXN0LWluLCBmaXJzdC1vdXQpOiB3aXRoIHNldERhdGFcbiAgLy8gYmFjayB0byB0aGUgb3JpZ2luYWwsIG9uZSByZW5kZXIoKSBkcmF3cyB0aGUgZ3JhcGggd2l0aG91dCBUWVAgY29sb3JzIGF0XG4gIC8vIG9uY2UgaW5zdGVhZCBvZiBvbiBpdHMgbmV4dCBjaGFuZ2UuXG4gIHBsdWdpbi5yZWdpc3RlcigoKSA9PiB7XG4gICAgZm9yIChjb25zdCBsZWFmIG9mIGdldEdyYXBoTGVhdmVzKHBsdWdpbi5hcHApKSAobGVhZi52aWV3Py5kYXRhRW5naW5lID8/IGxlYWYudmlldz8uZW5naW5lKT8ucmVuZGVyKCk7XG4gIH0pO1xuXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwibGF5b3V0LWNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi50eXBJbmRleC5vbihcImNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkocmVmcmVzaCk7XG5cbiAgcmV0dXJuIHJlZnJlc2g7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlckdyYXBoQ29sb3JzIH07XG4iLCAiY29uc3QgeyBjb2xvckZvckZpbGUsIHNldElubGluZUNvbG9yIH0gPSByZXF1aXJlKFwiLi90eXAtY29sb3JzXCIpO1xuXG5jb25zdCBTRUFSQ0hfVklFV19UWVBFID0gXCJzZWFyY2hcIjtcblxuLy8gU2VhcmNoIHJlc3VsdCByb3dzIGhhdmUgbm8gZGF0YS1wYXRoLCBidXQgdGhlIHZpZXcga2VlcHMgYSBURmlsZSAtPiByZXN1bHRcbi8vIERPTSBtYXAgKGRvbS5yZXN1bHREb21Mb29rdXApIHRoYXQgbGlua3MgZmlsZSBhbmQgcm93IGRpcmVjdGx5LlxuZnVuY3Rpb24gYXBwbHlTZWFyY2hDb2xvcnMocGx1Z2luKSB7XG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoU0VBUkNIX1ZJRVdfVFlQRSkpIHtcbiAgICBjb25zdCByZXN1bHREb21Mb29rdXAgPSBsZWFmLnZpZXc/LmRvbT8ucmVzdWx0RG9tTG9va3VwO1xuICAgIGlmICghcmVzdWx0RG9tTG9va3VwKSBjb250aW51ZTtcblxuICAgIGZvciAoY29uc3QgW2ZpbGUsIHJlc3VsdERvbV0gb2YgcmVzdWx0RG9tTG9va3VwKSB7XG4gICAgICBjb25zdCB0aXRsZUVsID0gcmVzdWx0RG9tLmVsPy5xdWVyeVNlbGVjdG9yKFwiLnNlYXJjaC1yZXN1bHQtZmlsZS10aXRsZSAudHJlZS1pdGVtLWlubmVyXCIpO1xuICAgICAgaWYgKCF0aXRsZUVsKSBjb250aW51ZTtcblxuICAgICAgY29uc3QgY29sb3IgPSBwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5zZWFyY2ggPyBjb2xvckZvckZpbGUocGx1Z2luLCBmaWxlLCBcInNlYXJjaFwiKSA6IG51bGw7XG4gICAgICBzZXRJbmxpbmVDb2xvcih0aXRsZUVsLCBjb2xvcik7XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyU2VhcmNoQ29sb3JzKHBsdWdpbikge1xuICBjb25zdCByZWZyZXNoID0gKCkgPT4gYXBwbHlTZWFyY2hDb2xvcnMocGx1Z2luKTtcblxuICAvLyBSZXN1bHRzIGFyZSByZWJ1aWx0IG9uIGV2ZXJ5IGtleXN0cm9rZS5cbiAgY29uc3Qgb2JzZXJ2ZXIgPSBuZXcgTXV0YXRpb25PYnNlcnZlcihyZWZyZXNoKTtcbiAgY29uc3Qgb2JzZXJ2ZUxlYXZlcyA9ICgpID0+IHtcbiAgICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFNFQVJDSF9WSUVXX1RZUEUpKSB7XG4gICAgICBvYnNlcnZlci5vYnNlcnZlKGxlYWYudmlldy5jb250YWluZXJFbCwgeyBjaGlsZExpc3Q6IHRydWUsIHN1YnRyZWU6IHRydWUgfSk7XG4gICAgfVxuICB9O1xuICBwbHVnaW4ucmVnaXN0ZXIoKCkgPT4gb2JzZXJ2ZXIuZGlzY29ubmVjdCgpKTtcblxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4udHlwSW5kZXgub24oXCJjaGFuZ2VcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChcbiAgICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImxheW91dC1jaGFuZ2VcIiwgKCkgPT4ge1xuICAgICAgb2JzZXJ2ZUxlYXZlcygpO1xuICAgICAgcmVmcmVzaCgpO1xuICAgIH0pXG4gICk7XG5cbiAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeSgoKSA9PiB7XG4gICAgb2JzZXJ2ZUxlYXZlcygpO1xuICAgIHJlZnJlc2goKTtcbiAgfSk7XG5cbiAgcmV0dXJuIHJlZnJlc2g7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlclNlYXJjaENvbG9ycyB9O1xuIiwgImNvbnN0IHsgY29sb3JGb3JGaWxlLCBzZXRJbmxpbmVDb2xvciB9ID0gcmVxdWlyZShcIi4vdHlwLWNvbG9yc1wiKTtcblxuY29uc3QgUkVDRU5UX0ZJTEVTX1ZJRVdfVFlQRSA9IFwicmVjZW50LWZpbGVzXCI7XG5cbi8vIFJlY2VudCBGaWxlcyByb3dzIGhhdmUgbm8gZGF0YS1wYXRoLCBidXQgdGhlIGxpc3QgaXMgcmVuZGVyZWQgc3RyYWlnaHQgZnJvbVxuLy8gZGF0YS5yZWNlbnRGaWxlcyB3aXRob3V0IHNraXBwaW5nIGVudHJpZXMsIHNvIHRoZSBpbmRleCBtYXBzIHJvdyB0byBwYXRoLlxuZnVuY3Rpb24gYXBwbHlSZWNlbnRGaWxlc0NvbG9ycyhwbHVnaW4pIHtcbiAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShSRUNFTlRfRklMRVNfVklFV19UWVBFKSkge1xuICAgIGNvbnN0IHJlY2VudEZpbGVzID0gbGVhZi52aWV3Py5kYXRhPy5yZWNlbnRGaWxlcztcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkocmVjZW50RmlsZXMpKSBjb250aW51ZTtcblxuICAgIGNvbnN0IHRpdGxlRWxzID0gbGVhZi52aWV3LmNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3JBbGwoXCIucmVjZW50LWZpbGVzLXRpdGxlIC5uYXYtZmlsZS10aXRsZS1jb250ZW50XCIpO1xuICAgIHRpdGxlRWxzLmZvckVhY2goKHRpdGxlRWwsIGluZGV4KSA9PiB7XG4gICAgICBjb25zdCBlbnRyeSA9IHJlY2VudEZpbGVzW2luZGV4XTtcbiAgICAgIGNvbnN0IGZpbGUgPSBlbnRyeSA/IHBsdWdpbi5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKGVudHJ5LnBhdGgpIDogbnVsbDtcbiAgICAgIGNvbnN0IGNvbG9yID0gcGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MucmVjZW50RmlsZXMgPyBjb2xvckZvckZpbGUocGx1Z2luLCBmaWxlLCBcInJlY2VudEZpbGVzXCIpIDogbnVsbDtcbiAgICAgIHNldElubGluZUNvbG9yKHRpdGxlRWwsIGNvbG9yKTtcbiAgICB9KTtcbiAgfVxufVxuXG5mdW5jdGlvbiByZWdpc3RlclJlY2VudEZpbGVzQ29sb3JzKHBsdWdpbikge1xuICBjb25zdCByZWZyZXNoID0gKCkgPT4gYXBwbHlSZWNlbnRGaWxlc0NvbG9ycyhwbHVnaW4pO1xuXG4gIGNvbnN0IG9ic2VydmVyID0gbmV3IE11dGF0aW9uT2JzZXJ2ZXIocmVmcmVzaCk7XG4gIGNvbnN0IG9ic2VydmVMZWF2ZXMgPSAoKSA9PiB7XG4gICAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShSRUNFTlRfRklMRVNfVklFV19UWVBFKSkge1xuICAgICAgb2JzZXJ2ZXIub2JzZXJ2ZShsZWFmLnZpZXcuY29udGFpbmVyRWwsIHsgY2hpbGRMaXN0OiB0cnVlLCBzdWJ0cmVlOiB0cnVlIH0pO1xuICAgIH1cbiAgfTtcbiAgcGx1Z2luLnJlZ2lzdGVyKCgpID0+IG9ic2VydmVyLmRpc2Nvbm5lY3QoKSk7XG5cbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLnR5cEluZGV4Lm9uKFwiY2hhbmdlXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoXG4gICAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJsYXlvdXQtY2hhbmdlXCIsICgpID0+IHtcbiAgICAgIG9ic2VydmVMZWF2ZXMoKTtcbiAgICAgIHJlZnJlc2goKTtcbiAgICB9KVxuICApO1xuXG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkoKCkgPT4ge1xuICAgIG9ic2VydmVMZWF2ZXMoKTtcbiAgICByZWZyZXNoKCk7XG4gIH0pO1xuXG4gIHJldHVybiByZWZyZXNoO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJSZWNlbnRGaWxlc0NvbG9ycyB9O1xuIiwgImNvbnN0IHsgY29sb3JGb3JGaWxlLCBzZXRJbmxpbmVDb2xvciB9ID0gcmVxdWlyZShcIi4vdHlwLWNvbG9yc1wiKTtcblxuY29uc3QgQkFDS0xJTktfVklFV19UWVBFID0gXCJiYWNrbGlua1wiO1xuXG4vLyBUaGUgYmFja2xpbmtzIHBhbmUgcmVuZGVycyByZXN1bHRzIHdpdGggdGhlIHNhbWUgU2VhcmNoUmVzdWx0RG9tIGNsYXNzIGFzXG4vLyBzZWFyY2guIExpbmtlZCBhbmQgdW5saW5rZWQgbWVudGlvbnMgYXJlIHR3byByZXN1bHREb21Mb29rdXAgbWFwcyBvbiB0aGVcbi8vIHJlbmRlcmVyICh2aWV3LmJhY2tsaW5rKS4gVGhlIGZpZWxkIG5hbWVzIGFyZSB1bmRvY3VtZW50ZWQsIHNvIHNldmVyYWxcbi8vIGtub3duIHBhdGhzIGFyZSB0cmllZC5cbmZ1bmN0aW9uIGdldFJlc3VsdERvbUxvb2t1cHModmlldykge1xuICBjb25zdCByZW5kZXJlciA9IHZpZXc/LmJhY2tsaW5rO1xuICBjb25zdCBjYW5kaWRhdGVzID0gW3JlbmRlcmVyPy5iYWNrbGlua0RvbSwgcmVuZGVyZXI/LnVubGlua2VkRG9tLCB2aWV3Py5iYWNrbGlua0RvbSwgdmlldz8udW5saW5rZWREb20sIHZpZXc/LmRvbV07XG5cbiAgY29uc3QgbG9va3VwcyA9IFtdO1xuICBmb3IgKGNvbnN0IGRvbSBvZiBjYW5kaWRhdGVzKSB7XG4gICAgaWYgKGRvbT8ucmVzdWx0RG9tTG9va3VwIGluc3RhbmNlb2YgTWFwKSBsb29rdXBzLnB1c2goZG9tLnJlc3VsdERvbUxvb2t1cCk7XG4gIH1cbiAgcmV0dXJuIGxvb2t1cHM7XG59XG5cbmZ1bmN0aW9uIGNvbG9yVGl0bGVFbChwbHVnaW4sIGVsLCBmaWxlKSB7XG4gIGNvbnN0IGNvbG9yID0gcGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MuYmFja2xpbmtzID8gY29sb3JGb3JGaWxlKHBsdWdpbiwgZmlsZSwgXCJiYWNrbGlua3NcIikgOiBudWxsO1xuICBzZXRJbmxpbmVDb2xvcihlbCwgY29sb3IpO1xufVxuXG5mdW5jdGlvbiBhcHBseUJhY2tsaW5rUGFuZUNvbG9ycyhwbHVnaW4pIHtcbiAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShCQUNLTElOS19WSUVXX1RZUEUpKSB7XG4gICAgZm9yIChjb25zdCBsb29rdXAgb2YgZ2V0UmVzdWx0RG9tTG9va3VwcyhsZWFmLnZpZXcpKSB7XG4gICAgICBmb3IgKGNvbnN0IFtmaWxlLCByZXN1bHREb21dIG9mIGxvb2t1cCkge1xuICAgICAgICBjb25zdCB0aXRsZUVsID0gcmVzdWx0RG9tLmVsPy5xdWVyeVNlbGVjdG9yKFwiLnNlYXJjaC1yZXN1bHQtZmlsZS10aXRsZSAudHJlZS1pdGVtLWlubmVyXCIpO1xuICAgICAgICBpZiAodGl0bGVFbCkgY29sb3JUaXRsZUVsKHBsdWdpbiwgdGl0bGVFbCwgZmlsZSk7XG4gICAgICB9XG4gICAgfVxuICB9XG59XG5cbi8vIEJhY2tsaW5rcyBpbiB0aGUgZG9jdW1lbnQgYXJlIG5vdCBhIGxlYWYgb2YgdGhlaXIgb3duIGJ1dCBlbWJlZGRlZCBhdCB0aGVcbi8vIGJvdHRvbSBvZiB0aGUgbWFya2Rvd24gdmlldyAoLmVtYmVkZGVkLWJhY2tsaW5rcykuIFJvd3MgaGF2ZSBubyBkYXRhLXBhdGgsXG4vLyBzbyB0aGUgZmlsZSBpcyByZXNvbHZlZCBmcm9tIHRoZSBzaG93biBuYW1lLCB0aGUgd2F5IE9ic2lkaWFuIHJlc29sdmVzIGxpbmtzLlxuZnVuY3Rpb24gYXBwbHlFbWJlZGRlZEJhY2tsaW5rQ29sb3JzKHBsdWdpbikge1xuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFwibWFya2Rvd25cIikpIHtcbiAgICBjb25zdCBwYW5lRWwgPSBsZWFmLnZpZXcuY29udGFpbmVyRWwucXVlcnlTZWxlY3RvcihcIi5lbWJlZGRlZC1iYWNrbGlua3MgLmJhY2tsaW5rLXBhbmVcIik7XG4gICAgaWYgKCFwYW5lRWwpIGNvbnRpbnVlO1xuXG4gICAgY29uc3Qgc291cmNlUGF0aCA9IGxlYWYudmlldy5maWxlPy5wYXRoID8/IFwiXCI7XG4gICAgY29uc3QgdGl0bGVFbHMgPSBwYW5lRWwucXVlcnlTZWxlY3RvckFsbChcIi5zZWFyY2gtcmVzdWx0LWZpbGUtdGl0bGUgLnRyZWUtaXRlbS1pbm5lclwiKTtcbiAgICBmb3IgKGNvbnN0IHRpdGxlRWwgb2YgdGl0bGVFbHMpIHtcbiAgICAgIGNvbnN0IGJhc2VuYW1lID0gdGl0bGVFbC50ZXh0Q29udGVudDtcbiAgICAgIGNvbnN0IGZpbGUgPSBiYXNlbmFtZSA/IHBsdWdpbi5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaXJzdExpbmtwYXRoRGVzdChiYXNlbmFtZSwgc291cmNlUGF0aCkgOiBudWxsO1xuICAgICAgY29sb3JUaXRsZUVsKHBsdWdpbiwgdGl0bGVFbCwgZmlsZSk7XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIGFwcGx5QmFja2xpbmtDb2xvcnMocGx1Z2luKSB7XG4gIGFwcGx5QmFja2xpbmtQYW5lQ29sb3JzKHBsdWdpbik7XG4gIGFwcGx5RW1iZWRkZWRCYWNrbGlua0NvbG9ycyhwbHVnaW4pO1xufVxuXG5mdW5jdGlvbiByZWdpc3RlckJhY2tsaW5rQ29sb3JzKHBsdWdpbikge1xuICBjb25zdCByZWZyZXNoID0gKCkgPT4gYXBwbHlCYWNrbGlua0NvbG9ycyhwbHVnaW4pO1xuXG4gIC8vIE9ubHkgdGhlIHNtYWxsIHNpZGViYXIgcGFuZSBpcyBvYnNlcnZlZCwgbmV2ZXIgYSBtYXJrZG93biB2aWV3OiBhIHN1YnRyZWVcbiAgLy8gb2JzZXJ2ZXIgbmVhciB0aGUgZWRpdG9yIGZpcmVzIG9uIGV2ZXJ5IGtleXN0cm9rZSBhbmQgb25jZSBmcm96ZSB0aGlzXG4gIC8vIHZhdWx0LiBUaGUgZW1iZWRkZWQgYmFja2xpbmtzIG9ubHkgY2hhbmdlIHdoZW4gbGlua3MgY2hhbmdlIChcInJlc29sdmVkXCIpXG4gIC8vIG9yIHRoZSBub3RlIGNoYW5nZXMgKGxheW91dC1jaGFuZ2UvYWN0aXZlLWxlYWYtY2hhbmdlKSwgYm90aCBjb3ZlcmVkIGJlbG93LlxuICBjb25zdCBvYnNlcnZlciA9IG5ldyBNdXRhdGlvbk9ic2VydmVyKHJlZnJlc2gpO1xuICBjb25zdCBvYnNlcnZlTGVhdmVzID0gKCkgPT4ge1xuICAgIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoQkFDS0xJTktfVklFV19UWVBFKSkge1xuICAgICAgb2JzZXJ2ZXIub2JzZXJ2ZShsZWFmLnZpZXcuY29udGFpbmVyRWwsIHsgY2hpbGRMaXN0OiB0cnVlLCBzdWJ0cmVlOiB0cnVlIH0pO1xuICAgIH1cbiAgfTtcbiAgcGx1Z2luLnJlZ2lzdGVyKCgpID0+IG9ic2VydmVyLmRpc2Nvbm5lY3QoKSk7XG5cbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLnR5cEluZGV4Lm9uKFwiY2hhbmdlXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC5tZXRhZGF0YUNhY2hlLm9uKFwicmVzb2x2ZWRcIiwgKCkgPT4gYXBwbHlFbWJlZGRlZEJhY2tsaW5rQ29sb3JzKHBsdWdpbikpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoXG4gICAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJsYXlvdXQtY2hhbmdlXCIsICgpID0+IHtcbiAgICAgIG9ic2VydmVMZWF2ZXMoKTtcbiAgICAgIHJlZnJlc2goKTtcbiAgICB9KVxuICApO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImFjdGl2ZS1sZWFmLWNoYW5nZVwiLCByZWZyZXNoKSk7XG5cbiAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeSgoKSA9PiB7XG4gICAgb2JzZXJ2ZUxlYXZlcygpO1xuICAgIHJlZnJlc2goKTtcbiAgfSk7XG5cbiAgcmV0dXJuIHJlZnJlc2g7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlckJhY2tsaW5rQ29sb3JzIH07XG4iLCAiY29uc3QgeyBjb2xvckZvckZpbGUsIHNldElubGluZUNvbG9yIH0gPSByZXF1aXJlKFwiLi90eXAtY29sb3JzXCIpO1xuXG5jb25zdCBCT09LTUFSS1NfVklFV19UWVBFID0gXCJib29rbWFya3NcIjtcbmNvbnN0IEJPT0tNQVJLU19QTFVHSU5fSUQgPSBcImJvb2ttYXJrc1wiO1xuXG4vLyBCb29rbWFyayByb3dzIGhhdmUgbm8gZGF0YS1wYXRoLiBUaGUgdmlldyBrZWVwcyBhIFdlYWtNYXAgKHZpZXcuaXRlbURvbXM6XG4vLyBpdGVtIC0+IHRyZWUgaXRlbSB3aXRoIC50aXRsZUVsKSwgd2hpY2ggY2FuJ3QgYmUgaXRlcmF0ZWQsIHNvIHdlIHdhbGsgdGhlXG4vLyBwbHVnaW4ncyBvd24gaXRlbSB0cmVlIChhbHdheXMgY29tcGxldGUsIHdoYXRldmVyIGlzIGNvbGxhcHNlZCkgYW5kIGxvb2sgdXBcbi8vIGVhY2ggaXRlbSdzIHJvdyB3aXRoIC5nZXQoKS5cbmZ1bmN0aW9uIGZvckVhY2hGaWxlQm9va21hcmsoaXRlbXMsIGNhbGxiYWNrKSB7XG4gIGZvciAoY29uc3QgaXRlbSBvZiBpdGVtcyA/PyBbXSkge1xuICAgIGlmIChpdGVtLnR5cGUgPT09IFwiZmlsZVwiKSBjYWxsYmFjayhpdGVtKTtcbiAgICBlbHNlIGlmIChpdGVtLnR5cGUgPT09IFwiZ3JvdXBcIikgZm9yRWFjaEZpbGVCb29rbWFyayhpdGVtLml0ZW1zLCBjYWxsYmFjayk7XG4gIH1cbn1cblxuZnVuY3Rpb24gYXBwbHlCb29rbWFya3NDb2xvcnMocGx1Z2luKSB7XG4gIGNvbnN0IGJvb2ttYXJrc1BsdWdpbiA9IHBsdWdpbi5hcHAuaW50ZXJuYWxQbHVnaW5zLmdldEVuYWJsZWRQbHVnaW5CeUlkKEJPT0tNQVJLU19QTFVHSU5fSUQpO1xuICBpZiAoIWJvb2ttYXJrc1BsdWdpbikgcmV0dXJuO1xuXG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoQk9PS01BUktTX1ZJRVdfVFlQRSkpIHtcbiAgICBjb25zdCBpdGVtRG9tcyA9IGxlYWYudmlldz8uaXRlbURvbXM7XG4gICAgaWYgKCFpdGVtRG9tcykgY29udGludWU7XG5cbiAgICBmb3JFYWNoRmlsZUJvb2ttYXJrKGJvb2ttYXJrc1BsdWdpbi5pdGVtcywgKGl0ZW0pID0+IHtcbiAgICAgIGNvbnN0IHRpdGxlRWwgPSBpdGVtRG9tcy5nZXQoaXRlbSk/LnRpdGxlRWw7XG4gICAgICBpZiAoIXRpdGxlRWwpIHJldHVybjtcblxuICAgICAgY29uc3QgZmlsZSA9IHBsdWdpbi5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKGl0ZW0ucGF0aCk7XG4gICAgICBjb25zdCBjb2xvciA9IHBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLmJvb2ttYXJrcyA/IGNvbG9yRm9yRmlsZShwbHVnaW4sIGZpbGUsIFwiYm9va21hcmtzXCIpIDogbnVsbDtcbiAgICAgIHNldElubGluZUNvbG9yKHRpdGxlRWwsIGNvbG9yKTtcbiAgICB9KTtcbiAgfVxufVxuXG5mdW5jdGlvbiByZWdpc3RlckJvb2ttYXJrc0NvbG9ycyhwbHVnaW4pIHtcbiAgY29uc3QgcmVmcmVzaCA9ICgpID0+IGFwcGx5Qm9va21hcmtzQ29sb3JzKHBsdWdpbik7XG5cbiAgLy8gUm93cyBhcmUgcmUtcmVuZGVyZWQgd2hlbiBncm91cHMgZXhwYW5kL2NvbGxhcHNlIG9yIGJvb2ttYXJrcyBjaGFuZ2UuXG4gIGNvbnN0IG9ic2VydmVyID0gbmV3IE11dGF0aW9uT2JzZXJ2ZXIocmVmcmVzaCk7XG4gIGNvbnN0IG9ic2VydmVMZWF2ZXMgPSAoKSA9PiB7XG4gICAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShCT09LTUFSS1NfVklFV19UWVBFKSkge1xuICAgICAgb2JzZXJ2ZXIub2JzZXJ2ZShsZWFmLnZpZXcuY29udGFpbmVyRWwsIHsgY2hpbGRMaXN0OiB0cnVlLCBzdWJ0cmVlOiB0cnVlIH0pO1xuICAgIH1cbiAgfTtcbiAgcGx1Z2luLnJlZ2lzdGVyKCgpID0+IG9ic2VydmVyLmRpc2Nvbm5lY3QoKSk7XG5cbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLnR5cEluZGV4Lm9uKFwiY2hhbmdlXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoXG4gICAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJsYXlvdXQtY2hhbmdlXCIsICgpID0+IHtcbiAgICAgIG9ic2VydmVMZWF2ZXMoKTtcbiAgICAgIHJlZnJlc2goKTtcbiAgICB9KVxuICApO1xuXG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkoKCkgPT4ge1xuICAgIG9ic2VydmVMZWF2ZXMoKTtcbiAgICByZWZyZXNoKCk7XG4gIH0pO1xuXG4gIHJldHVybiByZWZyZXNoO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJCb29rbWFya3NDb2xvcnMgfTtcbiIsICJjb25zdCB7IFRGaWxlIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5jb25zdCB7IGNvbG9yRm9yRmlsZSwgc3VidHlwQ29sb3IsIHN1YnR5cEhhc093bkNvbG9yLCBzZXRJbmxpbmVDb2xvciB9ID0gcmVxdWlyZShcIi4vdHlwLWNvbG9yc1wiKTtcbmNvbnN0IHsgZ2V0U3VidHlwIH0gPSByZXF1aXJlKFwiLi9zdWJ0eXBzXCIpO1xuXG5jb25zdCBET1RfQ0xBU1MgPSBcInR5cC10aXRsZS1kb3RcIjtcbmNvbnN0IERPVF9IT0xMT1dfQ0xBU1MgPSBcInR5cC10aXRsZS1kb3QtaG9sbG93XCI7XG4vLyBTYW1lIGFzIERFRkFVTFRfVFlQX0NPTE9SIGluIHR5cC1wYW5lLmpzIChhIFRZUCB3aXRob3V0IGl0cyBvd24gY29sb3IpLlxuY29uc3QgREVGQVVMVF9ET1RfQ09MT1IgPSBcIiM4ODg4ODhcIjtcbmNvbnN0IEJBREdFX0NMQVNTID0gXCJ0eXAtdGl0bGUtYmFkZ2VcIjtcbmNvbnN0IEJBREdFX1BMQUlOX0NMQVNTID0gXCJ0eXAtdGl0bGUtYmFkZ2UtcGxhaW5cIjtcbmNvbnN0IENPTE9SX1ZBUiA9IFwiLS10eXAtdGl0bGUtY29sb3JcIjtcblxuY29uc3QgQkxPQ0tfQkFER0VfQ0xBU1MgPSBcInR5cC1ibG9jay1iYWRnZVwiO1xuY29uc3QgQkxPQ0tfQkFER0VfUExBSU5fQ0xBU1MgPSBcInR5cC1ibG9jay1iYWRnZS1wbGFpblwiO1xuY29uc3QgQkxPQ0tfQUxJR05fVE9QX0NMQVNTID0gXCJ0eXAtYmxvY2stYmFkZ2UtdG9wXCI7XG5jb25zdCBCTE9DS19BTElHTl9CT1RUT01fQ0xBU1MgPSBcInR5cC1ibG9jay1iYWRnZS1ib3R0b21cIjtcbmNvbnN0IEJMT0NLX0NPTE9SX1ZBUiA9IFwiLS10eXAtYmxvY2stY29sb3JcIjtcblxuLy8gbm90ZVRpdGxlU3R5bGU6IFwibm9uZVwiIHwgXCJkb3RcIiB8IFwiYmFkZ2VcIi4gRm9yIFwiYmFkZ2VcIiwgbm90ZVRpdGxlQmFkZ2VDb2xvcmVkXG4vLyBhbmQgbm90ZVRpdGxlQmFkZ2VQb3NpdGlvbiAoXCJ0aXRsZVwiIHwgXCJibG9ja1wiLCBwbHVzIG5vdGVUaXRsZVZlcnRpY2FsQWxpZ25cbi8vIGZvciBcImJsb2NrXCIpIHJlZmluZSBpdC4gY29sb3JWaWV3cy5ub3RlVGl0bGVDb2xvciAodGhlIHRpdGxlIHRleHQgaXRzZWxmKSBpc1xuLy8gaW5kZXBlbmRlbnQgYW5kIGNvbWJpbmVzIHdpdGggYW55IG9mIHRoZXNlLlxuZnVuY3Rpb24gcmVzb2x2ZU1hcmtlcihwbHVnaW4sIGZpbGUpIHtcbiAgY29uc3Qgc3R5bGUgPSBwbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlU3R5bGU7XG4gIGlmIChzdHlsZSA9PT0gXCJub25lXCIpIHJldHVybiB7IGtpbmQ6IFwibm9uZVwiIH07XG4gIGlmIChzdHlsZSA9PT0gXCJkb3RcIikgcmV0dXJuIHsga2luZDogXCJkb3RcIiwgLi4ucmVzb2x2ZURvdChwbHVnaW4sIGZpbGUpIH07XG5cbiAgLy8gXCJiYWRnZVwiOiBjb2xvcmVkLCBhIHJlZ2lzdGVyZWQgVFlQIHdpdGhvdXQgYSBjb2xvciBnZXRzIHRoZSBncmF5IGRlZmF1bHRcbiAgLy8gKGxpa2UgdGhlIHJpbmcgaW4gcmVzb2x2ZURvdCk7IGFuIHVucmVnaXN0ZXJlZCBUWVAgZ2V0cyBubyBjb2xvcmVkIGJhZGdlLFxuICAvLyBqdXN0IGFzIGl0IGdldHMgbm8gZG90LlxuICBjb25zdCB7IHNldHRpbmdzIH0gPSBwbHVnaW47XG4gIGNvbnN0IHR5cCA9IHBsdWdpbi50eXBJbmRleC50eXBPZihmaWxlKTtcbiAgaWYgKCF0eXApIHJldHVybiB7IGtpbmQ6IFwibm9uZVwiIH07XG4gIGNvbnN0IGNvbG9yZWQgPSBzZXR0aW5ncy5ub3RlVGl0bGVCYWRnZUNvbG9yZWQ7XG4gIGlmIChjb2xvcmVkICYmICFzZXR0aW5ncy50eXBDb2xvcnNbdHlwXSAmJiAhc2V0dGluZ3MudHlwcy5pbmNsdWRlcyh0eXApKSByZXR1cm4geyBraW5kOiBcIm5vbmVcIiB9O1xuICBjb25zdCB0eXBDb2xvciA9IHNldHRpbmdzLnR5cENvbG9yc1t0eXBdID8/IERFRkFVTFRfRE9UX0NPTE9SO1xuXG4gIGNvbnN0IGxhYmVsID0gYmFkZ2VMYWJlbChwbHVnaW4sIGZpbGUsIHR5cCk7XG4gIGlmICghbGFiZWwpIHJldHVybiB7IGtpbmQ6IFwibm9uZVwiIH07XG4gIGNvbnN0IHsgdGV4dCwgdXNlU3VidHlwQ29sb3IsIHN1YnR5cCB9ID0gbGFiZWw7XG4gIGNvbnN0IGNvbG9yID0gY29sb3JlZCA/ICh1c2VTdWJ0eXBDb2xvciA/IHN1YnR5cENvbG9yKHNldHRpbmdzLCB0eXAsIHN1YnR5cCkgPz8gdHlwQ29sb3IgOiB0eXBDb2xvcikgOiBudWxsO1xuICBjb25zdCBwb3NpdGlvbiA9IHNldHRpbmdzLm5vdGVUaXRsZUJhZGdlUG9zaXRpb247XG4gIHJldHVybiB7IGtpbmQ6IHBvc2l0aW9uID09PSBcImJsb2NrXCIgPyBcImJsb2NrLWJhZGdlXCIgOiBcInRpdGxlLWJhZGdlXCIsIGNvbG9yZWQsIGNvbG9yLCB0eXBOYW1lOiB0ZXh0IH07XG59XG5cbi8vIEJhZGdlIGxhYmVsIChub3RlVGl0bGVCYWRnZUxhYmVsKSB3aXRoIGl0cyBjb2xvcjogW1RZUF0gaW4gdGhlIFRZUCBjb2xvcixcbi8vIFtTdWJ0eXBdIGluIHRoZSBTdWJ0eXAgY29sb3IgKG5vIGJhZGdlIHdpdGhvdXQgYSBTdWJ0eXApLCBbVFlQL1N1YnR5cF1cbi8vIGRlcGVuZGluZyBvbiB0aGUgXCJTdWJ0eXAgY29sb3JcIiB0b2dnbGUgKGNvbG9yVmlld3Mubm90ZVRpdGxlTWFya2VyU3VidHlwKS5cbi8vIEFuIHVucmVnaXN0ZXJlZCBTVUJUWVAgdmFsdWUgaXMgc2hvd24gYnV0IGhhcyBubyBjb2xvciBvZiBpdHMgb3duXG4vLyAoc3VidHlwQ29sb3IgdGhlbiByZXR1cm5zIHRoZSBUWVAgY29sb3IpLlxuZnVuY3Rpb24gYmFkZ2VMYWJlbChwbHVnaW4sIGZpbGUsIHR5cCkge1xuICBjb25zdCB7IHNldHRpbmdzIH0gPSBwbHVnaW47XG4gIGNvbnN0IHN1YnR5cCA9IHBsdWdpbi50eXBJbmRleC5zdWJ0eXBPZihmaWxlKTtcbiAgY29uc3QgbW9kZSA9IHNldHRpbmdzLm5vdGVUaXRsZUJhZGdlTGFiZWwgPz8gXCJ0eXBcIjtcbiAgaWYgKG1vZGUgPT09IFwic3VidHlwXCIpIHJldHVybiBzdWJ0eXAgPyB7IHRleHQ6IHN1YnR5cCwgdXNlU3VidHlwQ29sb3I6IHRydWUsIHN1YnR5cCB9IDogbnVsbDtcbiAgaWYgKCFzdWJ0eXAgfHwgbW9kZSA9PT0gXCJ0eXBcIikgcmV0dXJuIHsgdGV4dDogdHlwLCB1c2VTdWJ0eXBDb2xvcjogZmFsc2UsIHN1YnR5cCB9O1xuICByZXR1cm4geyB0ZXh0OiBgJHt0eXB9LyR7c3VidHlwfWAsIHVzZVN1YnR5cENvbG9yOiAhIXNldHRpbmdzLmNvbG9yVmlld3Mubm90ZVRpdGxlTWFya2VyU3VidHlwLCBzdWJ0eXAgfTtcbn1cblxuLy8gRG90IGF0IHRoZSB0aXRsZS4gTGlrZSB0aGUgZG90cyBpbiB0aGUgVFlQLVBhbmUgKHBhaW50Q29sb3JEb3QgaW5cbi8vIHR5cC1jb2xvcnMuanMpLCBhIGRlZmF1bHQgaXMgc2hvd24gYXMgYSBob2xsb3cgcmluZzogZ3JheSBmb3IgYSByZWdpc3RlcmVkXG4vLyBUWVAgd2l0aG91dCBhIGNvbG9yLCB0aGUgaW5oZXJpdGVkIFRZUCBjb2xvciBmb3IgYSBTdWJ0eXAgd2l0aG91dCBpdHMgb3duLlxuLy8gVW5yZWdpc3RlcmVkIFRZUCB2YWx1ZXMgZ2V0IG5vIGRvdCwgYXMgaW4gdGhlIFRZUC1MaXN0LlxuZnVuY3Rpb24gcmVzb2x2ZURvdChwbHVnaW4sIGZpbGUpIHtcbiAgY29uc3QgdHlwID0gcGx1Z2luLnR5cEluZGV4LnR5cE9mKGZpbGUpO1xuICBpZiAoIXR5cCkgcmV0dXJuIHsgY29sb3I6IG51bGwsIGhvbGxvdzogZmFsc2UgfTtcbiAgY29uc3QgeyBzZXR0aW5ncyB9ID0gcGx1Z2luO1xuICBjb25zdCB0eXBDb2xvciA9IHNldHRpbmdzLnR5cENvbG9yc1t0eXBdO1xuICBpZiAoIXR5cENvbG9yKSB7XG4gICAgcmV0dXJuIHNldHRpbmdzLnR5cHMuaW5jbHVkZXModHlwKSA/IHsgY29sb3I6IERFRkFVTFRfRE9UX0NPTE9SLCBob2xsb3c6IHRydWUgfSA6IHsgY29sb3I6IG51bGwsIGhvbGxvdzogZmFsc2UgfTtcbiAgfVxuICBjb25zdCBzdWJ0eXAgPSBwbHVnaW4udHlwSW5kZXguc3VidHlwT2YoZmlsZSk7XG4gIGlmIChzZXR0aW5ncy5jb2xvclZpZXdzLm5vdGVUaXRsZU1hcmtlclN1YnR5cCAmJiBzdWJ0eXAgJiYgZ2V0U3VidHlwKHNldHRpbmdzLCB0eXAsIHN1YnR5cCkpIHtcbiAgICByZXR1cm4geyBjb2xvcjogc3VidHlwQ29sb3Ioc2V0dGluZ3MsIHR5cCwgc3VidHlwKSwgaG9sbG93OiAhc3VidHlwSGFzT3duQ29sb3Ioc2V0dGluZ3MsIHR5cCwgc3VidHlwKSB9O1xuICB9XG4gIHJldHVybiB7IGNvbG9yOiB0eXBDb2xvciwgaG9sbG93OiBmYWxzZSB9O1xufVxuXG4vLyBUaGUgbm90ZSdzIGlubGluZSB0aXRsZS4gRG9uZSBhcyA6OmJlZm9yZSAoc2VlIHN0eWxlcy5jc3MpLCBub3QgYXMgYW4gZXh0cmFcbi8vIGVsZW1lbnQgb3Igd3JhcHBlcjogc2V2ZXJhbCB0aGVtZXMgKE1pbmltYWwgYW1vbmcgdGhlbSkgc3R5bGUgLmlubGluZS10aXRsZVxuLy8gd2l0aCBjaGlsZCBzZWxlY3RvcnMsIHdoaWNoIGFuIGV4dHJhIGVsZW1lbnQgd291bGQgYnJlYWsuIEEgOjpiZWZvcmUgY2FuJ3Rcbi8vIGJlIGdpdmVuIGEgY29sb3Igb3IgdGV4dCBkaXJlY3RseSwgaGVuY2UgdGhlIENTUyB2YXJpYWJsZSBhbmQgdGhlIGRhdGFcbi8vIGF0dHJpYnV0ZSB0aGF0IGl0cyBydWxlcyByZWFkICh2YXIoKS9hdHRyKCkpLlxuZnVuY3Rpb24gYXBwbHlTdHlsZVRvVGl0bGUodGl0bGVFbCwgbWFya2VyKSB7XG4gIGNvbnN0IGlzRG90ID0gbWFya2VyLmtpbmQgPT09IFwiZG90XCIgJiYgISFtYXJrZXIuY29sb3I7XG4gIGNvbnN0IGlzQmFkZ2UgPSBtYXJrZXIua2luZCA9PT0gXCJ0aXRsZS1iYWRnZVwiO1xuXG4gIHRpdGxlRWwuY2xhc3NMaXN0LnRvZ2dsZShET1RfQ0xBU1MsIGlzRG90KTtcbiAgdGl0bGVFbC5jbGFzc0xpc3QudG9nZ2xlKERPVF9IT0xMT1dfQ0xBU1MsIGlzRG90ICYmICEhbWFya2VyLmhvbGxvdyk7XG4gIHRpdGxlRWwuY2xhc3NMaXN0LnRvZ2dsZShCQURHRV9DTEFTUywgaXNCYWRnZSAmJiBtYXJrZXIuY29sb3JlZCk7XG4gIHRpdGxlRWwuY2xhc3NMaXN0LnRvZ2dsZShCQURHRV9QTEFJTl9DTEFTUywgaXNCYWRnZSAmJiAhbWFya2VyLmNvbG9yZWQpO1xuXG4gIGlmIChpc0JhZGdlKSB0aXRsZUVsLmRhdGFzZXQudHlwID0gbWFya2VyLnR5cE5hbWU7XG4gIGVsc2UgZGVsZXRlIHRpdGxlRWwuZGF0YXNldC50eXA7XG5cbiAgY29uc3QgbWFya2VyQ29sb3IgPSAoaXNEb3QgJiYgbWFya2VyLmNvbG9yKSB8fCAoaXNCYWRnZSAmJiBtYXJrZXIuY29sb3JlZCAmJiBtYXJrZXIuY29sb3IpID8gbWFya2VyLmNvbG9yIDogbnVsbDtcbiAgaWYgKG1hcmtlckNvbG9yKSB0aXRsZUVsLnN0eWxlLnNldFByb3BlcnR5KENPTE9SX1ZBUiwgbWFya2VyQ29sb3IpO1xuICBlbHNlIHRpdGxlRWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoQ09MT1JfVkFSKTtcbn1cblxuLy8gVGhlIG5vdGUncyBwcm9wZXJ0eSBibG9jayAoLm1ldGFkYXRhLWNvbnRhaW5lciksIGZvciBwb3NpdGlvbiBcImJsb2NrXCI6IHRoZVxuLy8gc2FtZSBiYWRnZSwgdHVybmVkIDkwXHUwMEIwICh3cml0aW5nLW1vZGUgcmF0aGVyIHRoYW4gcm90YXRlKCksIHNvIGl0IGdyb3dzIHdpdGhcbi8vIHRoZSB0ZXh0IGluIHRoZSByaWdodCBkaXJlY3Rpb24pIGFuZCBhbmNob3JlZCBsZWZ0IGF0IHRoZSBibG9jaywgdG9wIG9yXG4vLyBib3R0b20uIEFzIGEgOjpiZWZvcmUgaXQgaGlkZXMgYW5kIHNob3dzIHdpdGggdGhlIGJsb2NrIChQcm9wZXJ0eS1CbG9jay5jc3MpLlxuZnVuY3Rpb24gYXBwbHlTdHlsZVRvQmxvY2socGx1Z2luLCBibG9ja0VsLCBtYXJrZXIpIHtcbiAgY29uc3QgaXNCbG9ja0JhZGdlID0gbWFya2VyLmtpbmQgPT09IFwiYmxvY2stYmFkZ2VcIjtcblxuICBibG9ja0VsLmNsYXNzTGlzdC50b2dnbGUoQkxPQ0tfQkFER0VfQ0xBU1MsIGlzQmxvY2tCYWRnZSAmJiBtYXJrZXIuY29sb3JlZCk7XG4gIGJsb2NrRWwuY2xhc3NMaXN0LnRvZ2dsZShCTE9DS19CQURHRV9QTEFJTl9DTEFTUywgaXNCbG9ja0JhZGdlICYmICFtYXJrZXIuY29sb3JlZCk7XG5cbiAgY29uc3QgYWxpZ24gPSBwbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlVmVydGljYWxBbGlnbjtcbiAgYmxvY2tFbC5jbGFzc0xpc3QudG9nZ2xlKEJMT0NLX0FMSUdOX1RPUF9DTEFTUywgaXNCbG9ja0JhZGdlICYmIGFsaWduICE9PSBcImJvdHRvbVwiKTtcbiAgYmxvY2tFbC5jbGFzc0xpc3QudG9nZ2xlKEJMT0NLX0FMSUdOX0JPVFRPTV9DTEFTUywgaXNCbG9ja0JhZGdlICYmIGFsaWduID09PSBcImJvdHRvbVwiKTtcblxuICBpZiAoaXNCbG9ja0JhZGdlKSBibG9ja0VsLmRhdGFzZXQudHlwID0gbWFya2VyLnR5cE5hbWU7XG4gIGVsc2UgZGVsZXRlIGJsb2NrRWwuZGF0YXNldC50eXA7XG5cbiAgY29uc3QgYmxvY2tDb2xvciA9IGlzQmxvY2tCYWRnZSAmJiBtYXJrZXIuY29sb3JlZCAmJiBtYXJrZXIuY29sb3IgPyBtYXJrZXIuY29sb3IgOiBudWxsO1xuICBpZiAoYmxvY2tDb2xvcikgYmxvY2tFbC5zdHlsZS5zZXRQcm9wZXJ0eShCTE9DS19DT0xPUl9WQVIsIGJsb2NrQ29sb3IpO1xuICBlbHNlIGJsb2NrRWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoQkxPQ0tfQ09MT1JfVkFSKTtcbn1cblxuZnVuY3Rpb24gYXBwbHlBY3RpdmVUaXRsZUNvbG9ycyhwbHVnaW4pIHtcbiAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcIm1hcmtkb3duXCIpKSB7XG4gICAgY29uc3QgY29udGFpbmVyRWwgPSBsZWFmLnZpZXcuY29udGFpbmVyRWw7XG4gICAgY29uc3QgZmlsZSA9IGxlYWYudmlldy5maWxlO1xuICAgIGNvbnN0IHR5cGVkRmlsZSA9IGZpbGUgaW5zdGFuY2VvZiBURmlsZSA/IGZpbGUgOiBudWxsO1xuICAgIGNvbnN0IG1hcmtlciA9IHJlc29sdmVNYXJrZXIocGx1Z2luLCB0eXBlZEZpbGUpO1xuXG4gICAgY29uc3QgdGl0bGVFbCA9IGNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3IoXCIuaW5saW5lLXRpdGxlXCIpO1xuICAgIGlmICh0aXRsZUVsKSB7XG4gICAgICBhcHBseVN0eWxlVG9UaXRsZSh0aXRsZUVsLCBtYXJrZXIpO1xuXG4gICAgICBjb25zdCB0ZXh0Q29sb3IgPSBwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5ub3RlVGl0bGVDb2xvciA/IGNvbG9yRm9yRmlsZShwbHVnaW4sIHR5cGVkRmlsZSwgXCJub3RlVGl0bGVDb2xvclwiKSA6IG51bGw7XG4gICAgICBzZXRJbmxpbmVDb2xvcih0aXRsZUVsLCB0ZXh0Q29sb3IpO1xuICAgIH1cblxuICAgIGNvbnN0IGJsb2NrRWwgPSBjb250YWluZXJFbC5xdWVyeVNlbGVjdG9yKFwiLm1ldGFkYXRhLWNvbnRhaW5lclwiKTtcbiAgICBpZiAoYmxvY2tFbCkgYXBwbHlTdHlsZVRvQmxvY2socGx1Z2luLCBibG9ja0VsLCBtYXJrZXIpO1xuICB9XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyQWN0aXZlVGl0bGVDb2xvcnMocGx1Z2luKSB7XG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiBhcHBseUFjdGl2ZVRpdGxlQ29sb3JzKHBsdWdpbik7XG5cbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLnR5cEluZGV4Lm9uKFwiY2hhbmdlXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJmaWxlLW9wZW5cIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImFjdGl2ZS1sZWFmLWNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwibGF5b3V0LWNoYW5nZVwiLCByZWZyZXNoKSk7XG5cbiAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeShyZWZyZXNoKTtcblxuICAvLyBEb3QsIGJhZGdlIGFuZCB0aGVpciBkYXRhIGF0dHJpYnV0ZSBhbmQgY29sb3IgdmFyaWFibGVzIHdvdWxkIG90aGVyd2lzZVxuICAvLyBzdGF5IG9uIG9wZW4gbm90ZXMgYWZ0ZXIgdGhlIHBsdWdpbiBpcyBkaXNhYmxlZCwgdW50aWwgdGhlIG5vdGUgaXNcbiAgLy8gcmUtcmVuZGVyZWQuIFRoZSB0aXRsZSB0ZXh0IGNvbG9yIGlzIGNsZWFyZWQgd2l0aCB0aGUgb3RoZXIgaW5saW5lIGNvbG9yc1xuICAvLyAoY2xlYXJJbmxpbmVDb2xvcnMsIHNlZSBtYWluLmpzKS5cbiAgcGx1Z2luLnJlZ2lzdGVyKCgpID0+IHtcbiAgICBjb25zdCBub25lID0geyBraW5kOiBcIm5vbmVcIiB9O1xuICAgIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoXCJtYXJrZG93blwiKSkge1xuICAgICAgY29uc3QgY29udGFpbmVyRWwgPSBsZWFmLnZpZXcuY29udGFpbmVyRWw7XG4gICAgICBjb25zdCB0aXRsZUVsID0gY29udGFpbmVyRWwucXVlcnlTZWxlY3RvcihcIi5pbmxpbmUtdGl0bGVcIik7XG4gICAgICBpZiAodGl0bGVFbCkgYXBwbHlTdHlsZVRvVGl0bGUodGl0bGVFbCwgbm9uZSk7XG4gICAgICBjb25zdCBibG9ja0VsID0gY29udGFpbmVyRWwucXVlcnlTZWxlY3RvcihcIi5tZXRhZGF0YS1jb250YWluZXJcIik7XG4gICAgICBpZiAoYmxvY2tFbCkgYXBwbHlTdHlsZVRvQmxvY2socGx1Z2luLCBibG9ja0VsLCBub25lKTtcbiAgICB9XG4gIH0pO1xuXG4gIHJldHVybiByZWZyZXNoO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJBY3RpdmVUaXRsZUNvbG9ycyB9O1xuIiwgImNvbnN0IHsgZWRpdG9ySW5mb0ZpZWxkLCBnZXRMaW5rcGF0aCB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyBWaWV3UGx1Z2luLCBEZWNvcmF0aW9uIH0gPSByZXF1aXJlKFwiQGNvZGVtaXJyb3Ivdmlld1wiKTtcbmNvbnN0IHsgUHJlYywgUmFuZ2VTZXRCdWlsZGVyLCBTdGF0ZUVmZmVjdCB9ID0gcmVxdWlyZShcIkBjb2RlbWlycm9yL3N0YXRlXCIpO1xuY29uc3QgeyBzeW50YXhUcmVlIH0gPSByZXF1aXJlKFwiQGNvZGVtaXJyb3IvbGFuZ3VhZ2VcIik7XG5jb25zdCB7IGNvbG9yRm9yRmlsZSwgYWxsRG9jdW1lbnRzIH0gPSByZXF1aXJlKFwiLi90eXAtY29sb3JzXCIpO1xuXG4vLyBDb2xvcnMgbGlua3MgaW4gbm90ZSB0ZXh0IGJ5IHRoZSBUWVAgb2YgdGhlaXIgdGFyZ2V0LiBPYnNpZGlhbiBjb2xvcnNcbi8vIGludGVybmFsIGxpbmtzIHRocm91Z2ggdmFyKC0tbGluay1jb2xvciksIHNvIG9ubHkgdGhhdCB2YXJpYWJsZSBpcyBzZXQgcGVyXG4vLyBsaW5rLiAtLWxpbmstY29sb3ItaG92ZXIgc3RheXMgdW50b3VjaGVkIChob3ZlciBzaG93cyB0aGUgbm9ybWFsIGxpbmsgY29sb3IpLFxuLy8gYW5kIHVuZGVybGluZSBhbmQgdGhlbWUgdHdlYWtzIGtlZXAgd29ya2luZy5cbi8vXG4vLyBUd28gc2VwYXJhdGUgcGF0aHMsIGJlY2F1c2UgdGhlIHR3byByZW5kZXJpbmdzIGhhdmUgbm90aGluZyBpbiBjb21tb246XG4vLyAgLSBSZWFkaW5nIHZpZXcsIGhvdmVyIHByZXZpZXcgYW5kIHJlbmRlcmVkIGJsb2NrcyBpbiBMaXZlIFByZXZpZXcgKHRhYmxlcyxcbi8vICAgIGNhbGxvdXRzKTogcmVhbCA8YSBjbGFzcz1cImludGVybmFsLWxpbmtcIiBkYXRhLWhyZWY+IGVsZW1lbnRzIC0+XG4vLyAgICBtYXJrZG93biBwb3N0LXByb2Nlc3Nvciwgb25jZSBwZXIgbGluayB3aGVuIHJlbmRlcmVkLlxuLy8gIC0gTGl2ZSBQcmV2aWV3L3NvdXJjZSBtb2RlOiBvbmx5IENvZGVNaXJyb3Igc3BhbnMgb3ZlciB0aGUgcmF3IHRleHQgLT5cbi8vICAgIGEgVmlld1BsdWdpbiB0aGF0IGxvb2tzIGF0IHRoZSB2aXNpYmxlIHJhbmdlIG9ubHkuXG4vL1xuLy8gUmVjb2xvcmluZyBvdGhlcndpc2Ugb25seSBoYXBwZW5zIG9uIGEgcmVhbCBUWVAgY2hhbmdlICh0eXBJbmRleCBcImNoYW5nZVwiKVxuLy8gb3IgYSBzZXR0aW5ncyBjaGFuZ2UsIG5vdCBvbiBldmVyeSBzYXZlLlxuXG5jb25zdCBDT0xPUl9WQVIgPSBcIi0tbGluay1jb2xvclwiO1xuY29uc3QgU09VUkNFX0FUVFIgPSBcImRhdGEtdHlwLXNyY1wiO1xuXG4vLyBbW3RhcmdldF1dLCBbW3RhcmdldHxhbGlhc11dLCBbW3RhcmdldCNoZWFkaW5nXV0uIEVtYmVkcyAoIVtbXHUyMDI2XV0pIGFyZSBub3Rcbi8vIGxpbmtzLiBJbnNpZGUgdGFibGVzIHRoZSBhbGlhcyBwaXBlIGlzIGVzY2FwZWQgKFwiXFx8XCIpLlxuY29uc3QgV0lLSUxJTktfUEFUVEVSTiA9IC8oPzwhISlcXFtcXFsoW15bXFxdXSs/KVxcXVxcXS9nO1xuXG5mdW5jdGlvbiBjb2xvckZvckxpbmt0ZXh0KHBsdWdpbiwgbGlua3RleHQsIHNvdXJjZVBhdGgpIHtcbiAgY29uc3QgdGFyZ2V0ID0gbGlua3RleHQuc3BsaXQoL1xcXFw/XFx8LylbMF0udHJpbSgpO1xuICBjb25zdCBsaW5rcGF0aCA9IGdldExpbmtwYXRoKHRhcmdldCk7XG4gIGlmICghbGlua3BhdGgpIHJldHVybiBudWxsO1xuICBjb25zdCBmaWxlID0gcGx1Z2luLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpcnN0TGlua3BhdGhEZXN0KGxpbmtwYXRoLCBzb3VyY2VQYXRoKTtcbiAgcmV0dXJuIGNvbG9yRm9yRmlsZShwbHVnaW4sIGZpbGUsIFwibGlua3NcIik7XG59XG5cbi8vIC0tLSBSZWFkaW5nIHZpZXcgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5mdW5jdGlvbiBhcHBseVRvQW5jaG9yKHBsdWdpbiwgYW5jaG9yRWwpIHtcbiAgY29uc3QgaHJlZiA9IGFuY2hvckVsLmdldEF0dHJpYnV0ZShcImRhdGEtaHJlZlwiKTtcbiAgY29uc3QgY29sb3IgPVxuICAgIHBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLmxpbmtzICYmIGhyZWYgJiYgIWFuY2hvckVsLmNsYXNzTGlzdC5jb250YWlucyhcImlzLXVucmVzb2x2ZWRcIilcbiAgICAgID8gY29sb3JGb3JMaW5rdGV4dChwbHVnaW4sIGhyZWYsIGFuY2hvckVsLmdldEF0dHJpYnV0ZShTT1VSQ0VfQVRUUikgPz8gXCJcIilcbiAgICAgIDogbnVsbDtcbiAgaWYgKGNvbG9yKSBhbmNob3JFbC5zdHlsZS5zZXRQcm9wZXJ0eShDT0xPUl9WQVIsIGNvbG9yKTtcbiAgZWxzZSBhbmNob3JFbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShDT0xPUl9WQVIpO1xufVxuXG4vLyBSZWNvbG9ycyBsaW5rcyB0aGF0IGFyZSBhbHJlYWR5IHJlbmRlcmVkLiBUaGUgcG9zdC1wcm9jZXNzb3Igc3RvcmVzIGVhY2hcbi8vIGxpbmsncyBzb3VyY2Ugbm90ZSBvbiBpdCwgd2hpY2ggYW1iaWd1b3VzIGxpbmsgdGV4dCBuZWVkcyB0byByZXNvbHZlLlxuLy8gQ292ZXJzIGFsbCB3aW5kb3dzIChwb3Atb3V0cyBpbmNsdWRlZCkuXG5mdW5jdGlvbiByZWZyZXNoUmVuZGVyZWRMaW5rcyhwbHVnaW4pIHtcbiAgZm9yIChjb25zdCBkb2Mgb2YgYWxsRG9jdW1lbnRzKHBsdWdpbi5hcHApKSB7XG4gICAgZm9yIChjb25zdCBhbmNob3JFbCBvZiBkb2MucXVlcnlTZWxlY3RvckFsbChgYS5pbnRlcm5hbC1saW5rWyR7U09VUkNFX0FUVFJ9XWApKSBhcHBseVRvQW5jaG9yKHBsdWdpbiwgYW5jaG9yRWwpO1xuICB9XG59XG5cbi8vIC0tLSBMaXZlIFByZXZpZXcgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5jb25zdCByZWZyZXNoRWZmZWN0ID0gU3RhdGVFZmZlY3QuZGVmaW5lKCk7XG5cbmZ1bmN0aW9uIGJ1aWxkTGlua1ZpZXdQbHVnaW4ocGx1Z2luKSB7XG4gIGNvbnN0IGRlY29yYXRpb25zQnlDb2xvciA9IG5ldyBNYXAoKTtcbiAgY29uc3QgZGVjb3JhdGlvbkZvciA9IChjb2xvcikgPT4ge1xuICAgIGxldCBkZWNvcmF0aW9uID0gZGVjb3JhdGlvbnNCeUNvbG9yLmdldChjb2xvcik7XG4gICAgaWYgKCFkZWNvcmF0aW9uKSB7XG4gICAgICBkZWNvcmF0aW9uID0gRGVjb3JhdGlvbi5tYXJrKHtcbiAgICAgICAgY2xhc3M6IFwidHlwLWxpbmtcIixcbiAgICAgICAgYXR0cmlidXRlczogeyBzdHlsZTogYCR7Q09MT1JfVkFSfTogJHtjb2xvcn07YCB9LFxuICAgICAgfSk7XG4gICAgICBkZWNvcmF0aW9uc0J5Q29sb3Iuc2V0KGNvbG9yLCBkZWNvcmF0aW9uKTtcbiAgICB9XG4gICAgcmV0dXJuIGRlY29yYXRpb247XG4gIH07XG5cbiAgY29uc3QgYnVpbGQgPSAodmlldykgPT4ge1xuICAgIGlmICghcGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MubGlua3MpIHJldHVybiBEZWNvcmF0aW9uLm5vbmU7XG4gICAgY29uc3Qgc291cmNlUGF0aCA9IHZpZXcuc3RhdGUuZmllbGQoZWRpdG9ySW5mb0ZpZWxkLCBmYWxzZSk/LmZpbGU/LnBhdGggPz8gXCJcIjtcbiAgICBjb25zdCB0cmVlID0gc3ludGF4VHJlZSh2aWV3LnN0YXRlKTtcbiAgICBjb25zdCBidWlsZGVyID0gbmV3IFJhbmdlU2V0QnVpbGRlcigpO1xuXG4gICAgZm9yIChjb25zdCB7IGZyb20sIHRvIH0gb2Ygdmlldy52aXNpYmxlUmFuZ2VzKSB7XG4gICAgICBjb25zdCB0ZXh0ID0gdmlldy5zdGF0ZS5zbGljZURvYyhmcm9tLCB0byk7XG4gICAgICBXSUtJTElOS19QQVRURVJOLmxhc3RJbmRleCA9IDA7XG4gICAgICBmb3IgKGxldCBtYXRjaDsgKG1hdGNoID0gV0lLSUxJTktfUEFUVEVSTi5leGVjKHRleHQpKTsgKSB7XG4gICAgICAgIGNvbnN0IHN0YXJ0ID0gZnJvbSArIG1hdGNoLmluZGV4O1xuICAgICAgICAvLyBPbmx5IHdoYXQgT2JzaWRpYW4ncyBwYXJzZXIgdHJlYXRzIGFzIGFuIGludGVybmFsIGxpbmssIHdoaWNoIHJ1bGVzXG4gICAgICAgIC8vIG91dCBbW1x1MjAyNl1dIGluIGNvZGUgYmxvY2tzIGFuZCBpbmxpbmUgY29kZS5cbiAgICAgICAgaWYgKCF0cmVlLnJlc29sdmVJbm5lcihzdGFydCArIDIsIDEpLm5hbWUuaW5jbHVkZXMoXCJobWQtaW50ZXJuYWwtbGlua1wiKSkgY29udGludWU7XG4gICAgICAgIGNvbnN0IGNvbG9yID0gY29sb3JGb3JMaW5rdGV4dChwbHVnaW4sIG1hdGNoWzFdLCBzb3VyY2VQYXRoKTtcbiAgICAgICAgaWYgKGNvbG9yKSBidWlsZGVyLmFkZChzdGFydCwgc3RhcnQgKyBtYXRjaFswXS5sZW5ndGgsIGRlY29yYXRpb25Gb3IoY29sb3IpKTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIGJ1aWxkZXIuZmluaXNoKCk7XG4gIH07XG5cbiAgcmV0dXJuIFZpZXdQbHVnaW4uZnJvbUNsYXNzKFxuICAgIGNsYXNzIHtcbiAgICAgIGNvbnN0cnVjdG9yKHZpZXcpIHtcbiAgICAgICAgdGhpcy5kZWNvcmF0aW9ucyA9IGJ1aWxkKHZpZXcpO1xuICAgICAgfVxuXG4gICAgICAvLyBUaGUgcGFyc2VyIG1heSB3b3JrIHRocm91Z2ggdGhlIHZpc2libGUgcmFuZ2UgYml0IGJ5IGJpdCwgc28gYSBuZXdcbiAgICAgIC8vIHN5bnRheCB0cmVlIGFsc28gdHJpZ2dlcnMgYSByZWJ1aWxkLlxuICAgICAgdXBkYXRlKHVwZGF0ZSkge1xuICAgICAgICBpZiAoXG4gICAgICAgICAgdXBkYXRlLmRvY0NoYW5nZWQgfHxcbiAgICAgICAgICB1cGRhdGUudmlld3BvcnRDaGFuZ2VkIHx8XG4gICAgICAgICAgc3ludGF4VHJlZSh1cGRhdGUuc3RhcnRTdGF0ZSkgIT09IHN5bnRheFRyZWUodXBkYXRlLnN0YXRlKSB8fFxuICAgICAgICAgIHVwZGF0ZS50cmFuc2FjdGlvbnMuc29tZSgodHIpID0+IHRyLmVmZmVjdHMuc29tZSgoZWZmZWN0KSA9PiBlZmZlY3QuaXMocmVmcmVzaEVmZmVjdCkpKVxuICAgICAgICApIHtcbiAgICAgICAgICB0aGlzLmRlY29yYXRpb25zID0gYnVpbGQodXBkYXRlLnZpZXcpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSxcbiAgICB7IGRlY29yYXRpb25zOiAodmFsdWUpID0+IHZhbHVlLmRlY29yYXRpb25zIH1cbiAgKTtcbn1cblxuLy8gUmV0dXJucyBzY2hlZHVsZSgpOiBhc2tzIGV2ZXJ5IGVkaXRvciB0byByZWJ1aWxkIGl0cyBsaW5rIGRlY29yYXRpb25zLCBhdFxuLy8gbW9zdCBvbmNlIHBlciBhbmltYXRpb24gZnJhbWUuXG4vL1xuLy8gTmV2ZXIgZGlzcGF0Y2hlZCBzeW5jaHJvbm91c2x5OiBhIHJlZnJlc2ggY2FuIGFycml2ZSB3aGlsZSBhbiBlZGl0b3IgaXMgaW5cbi8vIHRoZSBtaWRkbGUgb2YgaXRzIG93biB1cGRhdGUgKENvZGVNaXJyb3IgdGhlbiB0aHJvd3MgXCJDYWxscyB0b1xuLy8gRWRpdG9yVmlldy51cGRhdGUgYXJlIG5vdCBhbGxvd2VkIHdoaWxlIGFuIHVwZGF0ZSBpcyBpbiBwcm9ncmVzc1wiKSwgZm9yXG4vLyBpbnN0YW5jZSB3aGVuIHNvbWV0aGluZyBhbiB1cGRhdGUgc2V0cyBvZmYgZW5kcyBpbiByZWZyZXNoVHlwQ29sb3JzKCkuIFRoZVxuLy8gZnJhbWUgYWxzbyBidW5kbGVzIGJ1cnN0cyBvZiByZWZyZXNoZXMgLSBkcmFnZ2luZyBhIGNvbG9yIHNsaWRlciBzZW5kcyBvbmVcbi8vIHBlciBpbnB1dCBldmVudC4gQW4gZWRpdG9yIHN0aWxsIGJ1c3kgd2hlbiB0aGUgZnJhbWUgY29tZXMgKHVwZGF0ZVN0YXRlIGlzXG4vLyBDb2RlTWlycm9yJ3MgaW50ZXJuYWwgZmxhZywgMCA9IGlkbGU7IGl0IGlzIGFsc28gbm9uLXplcm8gd2hpbGUgbWVhc3VyaW5nKVxuLy8gaXMgcmV0cmllZCBhIGZyYW1lIGxhdGVyLlxuZnVuY3Rpb24gY3JlYXRlRWRpdG9yUmVmcmVzaGVyKHBsdWdpbikge1xuICBsZXQgZnJhbWUgPSBudWxsO1xuICBjb25zdCBydW4gPSAoKSA9PiB7XG4gICAgZnJhbWUgPSBudWxsO1xuICAgIGxldCBidXN5ID0gZmFsc2U7XG4gICAgcGx1Z2luLmFwcC53b3Jrc3BhY2UuaXRlcmF0ZUFsbExlYXZlcygobGVhZikgPT4ge1xuICAgICAgY29uc3QgY20gPSBsZWFmLnZpZXc/LmVkaXRvcj8uY207XG4gICAgICBpZiAoIWNtKSByZXR1cm47XG4gICAgICBpZiAoY20udXBkYXRlU3RhdGUgIT09IDApIHtcbiAgICAgICAgYnVzeSA9IHRydWU7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHRyeSB7XG4gICAgICAgIGNtLmRpc3BhdGNoKHsgZWZmZWN0czogcmVmcmVzaEVmZmVjdC5vZihudWxsKSB9KTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIC8vIE9uZSBlZGl0b3IgZmFpbGluZyBtdXN0IG5vdCBrZWVwIHRoZSBvdGhlcnMgZnJvbSByZWZyZXNoaW5nLlxuICAgICAgICBjb25zb2xlLmVycm9yKFwiW1RZUCBsaW5rIGNvbG9yc11cIiwgZXJyb3IpO1xuICAgICAgfVxuICAgIH0pO1xuICAgIGlmIChidXN5KSBzY2hlZHVsZSgpO1xuICB9O1xuICBjb25zdCBzY2hlZHVsZSA9ICgpID0+IHtcbiAgICBpZiAoZnJhbWUgPT09IG51bGwpIGZyYW1lID0gd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZShydW4pO1xuICB9O1xuICBwbHVnaW4ucmVnaXN0ZXIoKCkgPT4ge1xuICAgIGlmIChmcmFtZSAhPT0gbnVsbCkgd2luZG93LmNhbmNlbEFuaW1hdGlvbkZyYW1lKGZyYW1lKTtcbiAgICBmcmFtZSA9IG51bGw7XG4gIH0pO1xuICByZXR1cm4gc2NoZWR1bGU7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5mdW5jdGlvbiByZWdpc3RlckxpbmtDb2xvcnMocGx1Z2luKSB7XG4gIHBsdWdpbi5yZWdpc3Rlck1hcmtkb3duUG9zdFByb2Nlc3NvcigoZWwsIGN0eCkgPT4ge1xuICAgIC8vIFN0b3JlIHRoZSBzb3VyY2UgZXZlbiB3aGlsZSBjb2xvcmluZyBpcyBvZmYsIHNvIHR1cm5pbmcgaXQgb24gbGF0ZXJcbiAgICAvLyBhbHNvIGNvdmVycyBsaW5rcyB0aGF0IGFyZSBhbHJlYWR5IHJlbmRlcmVkLlxuICAgIGZvciAoY29uc3QgYW5jaG9yRWwgb2YgZWwucXVlcnlTZWxlY3RvckFsbChcImEuaW50ZXJuYWwtbGlua1wiKSkge1xuICAgICAgYW5jaG9yRWwuc2V0QXR0cmlidXRlKFNPVVJDRV9BVFRSLCBjdHguc291cmNlUGF0aCk7XG4gICAgICBhcHBseVRvQW5jaG9yKHBsdWdpbiwgYW5jaG9yRWwpO1xuICAgIH1cbiAgfSk7XG4gIC8vIE9ic2lkaWFuJ3MgXCIuY20taG1kLWludGVybmFsLWxpbmtcIiBzcGFuIGFsd2F5cyBlbmRzIHVwIG91dHNpZGUgb3VyIG1hcmssXG4gIC8vIHdoYXRldmVyIHRoZSBwcmlvcml0eSwgc28gYSBydWxlIGluIHN0eWxlcy5jc3MgKC50eXAtbGluaykgc2V0cyB0aGUgY29sb3IuXG4gIC8vIExvd2VzdCBwcmlvcml0eSBhdCBsZWFzdCB3cmFwcyBcIi5jbS11bmRlcmxpbmVcIiwgY292ZXJpbmcgdGhlIHdob2xlIHRleHQuXG4gIHBsdWdpbi5yZWdpc3RlckVkaXRvckV4dGVuc2lvbihQcmVjLmxvd2VzdChidWlsZExpbmtWaWV3UGx1Z2luKHBsdWdpbikpKTtcblxuICBjb25zdCByZWZyZXNoRWRpdG9ycyA9IGNyZWF0ZUVkaXRvclJlZnJlc2hlcihwbHVnaW4pO1xuICBjb25zdCByZWZyZXNoID0gKCkgPT4ge1xuICAgIHJlZnJlc2hSZW5kZXJlZExpbmtzKHBsdWdpbik7XG4gICAgcmVmcmVzaEVkaXRvcnMoKTtcbiAgfTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLnR5cEluZGV4Lm9uKFwiY2hhbmdlXCIsIHJlZnJlc2gpKTtcbiAgLy8gRWRpdG9yIGRlY29yYXRpb25zIGdvIGF3YXkgd2l0aCB0aGUgZXh0ZW5zaW9uIG9uIHVubG9hZCwgdGhlIGlubGluZVxuICAvLyB2YXJpYWJsZXMgb24gcmVuZGVyZWQgbGlua3MgZG9uJ3QuXG4gIHBsdWdpbi5yZWdpc3RlcigoKSA9PiB7XG4gICAgcGx1Z2luLmFwcC53b3Jrc3BhY2UuaXRlcmF0ZUFsbExlYXZlcygobGVhZikgPT4ge1xuICAgICAgZm9yIChjb25zdCBhbmNob3JFbCBvZiBsZWFmLnZpZXcuY29udGFpbmVyRWwucXVlcnlTZWxlY3RvckFsbChgYS5pbnRlcm5hbC1saW5rWyR7U09VUkNFX0FUVFJ9XWApKSB7XG4gICAgICAgIGFuY2hvckVsLnN0eWxlLnJlbW92ZVByb3BlcnR5KENPTE9SX1ZBUik7XG4gICAgICB9XG4gICAgfSk7XG4gIH0pO1xuICByZXR1cm4gcmVmcmVzaDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyTGlua0NvbG9ycyB9O1xuIiwgImNvbnN0IHsgZ2V0U3VidHlwTmFtZXMsIGdldFN1YnR5cCB9ID0gcmVxdWlyZShcIi4vc3VidHlwc1wiKTtcbmNvbnN0IHsgc3VidHlwQ29sb3IsIHNldElubGluZUNvbG9yLCBhbGxEb2N1bWVudHMgfSA9IHJlcXVpcmUoXCIuL3R5cC1jb2xvcnNcIik7XG5jb25zdCB7IFZJRVdfVFlQRV9UWVBfUEFORSB9ID0gcmVxdWlyZShcIi4vdHlwLXBhbmVcIik7XG5cbmNvbnN0IEFMTF9QUk9QRVJUSUVTX1ZJRVdfVFlQRSA9IFwiYWxsLXByb3BlcnRpZXNcIjtcbmNvbnN0IEhJR0hMSUdIVF9DTEFTUyA9IFwidHlwLWRlZmF1bHQtcHJvcGVydHlcIjtcbi8vIEZsb2F0aW5nIHByb3BlcnRpZXMgYXJlIG1hcmtlZCBpdGFsaWMgaW5zdGVhZCBvZiBib2xkLlxuY29uc3QgRkxPQVRJTkdfQ0xBU1MgPSBcInR5cC1mbG9hdGluZy1wcm9wZXJ0eVwiO1xuXG4vLyBPYnNpZGlhbiBhbHdheXMgbG93ZXJjYXNlcyBkYXRhLXByb3BlcnR5LWtleSwgc28gY29tcGFyaXNvbnMgaWdub3JlIGNhc2UuXG5mdW5jdGlvbiByYXdLZXlzRm9yVHlwKHR5cCwgZGVmYXVsdHMpIHtcbiAgaWYgKCF0eXAgfHwgIWRlZmF1bHRzKSByZXR1cm4gbnVsbDtcbiAgY29uc3Qga2V5cyA9IE9iamVjdC5rZXlzKGRlZmF1bHRzKS5maWx0ZXIoKGtleSkgPT4ga2V5ICE9PSBcIlwiKTtcbiAgcmV0dXJuIGtleXMubGVuZ3RoID4gMCA/IGtleXMubWFwKChrZXkpID0+IGtleS50b0xvd2VyQ2FzZSgpKSA6IG51bGw7XG59XG5cbi8vIEEgVFlQJ3MgZnJvbnRtYXR0ZXIgYmxvY2tzIGFzIFt7IHNlY3Rpb24sIGtleXMsIGZsb2F0aW5nIH1dIChsb3dlcmNhc2UpOlxuLy8gdGhlIFRZUC1Gcm9udG1hdHRlciBmaXJzdCwgdGhlbiBvcHRpb25hbGx5IG9uZSBTdWJ0eXAncyBibG9jayBvciwgd2l0aFxuLy8gQUxMX1NVQlRZUFMsIGV2ZXJ5IFN1YnR5cCdzIGJsb2NrIChzZWUgc3VidHlwcy5qcykuXG5jb25zdCBBTExfU1VCVFlQUyA9IFN5bWJvbChcImFsbC1zdWJ0eXBzXCIpO1xuXG5mdW5jdGlvbiBibG9ja09mKGRlZmF1bHRzLCBmbG9hdGluZ0tleXMsIHNlY3Rpb24gPSBudWxsKSB7XG4gIGNvbnN0IGtleXMgPSByYXdLZXlzRm9yVHlwKHRydWUsIGRlZmF1bHRzKSA/PyBbXTtcbiAgcmV0dXJuIHsgc2VjdGlvbiwga2V5cywgZmxvYXRpbmc6IG5ldyBTZXQoKGZsb2F0aW5nS2V5cyA/PyBbXSkubWFwKChrZXkpID0+IGtleS50b0xvd2VyQ2FzZSgpKSkgfTtcbn1cblxuZnVuY3Rpb24gYmxvY2tzRm9yVHlwKHBsdWdpbiwgdHlwLCBzdWJ0eXApIHtcbiAgY29uc3QgeyBzZXR0aW5ncyB9ID0gcGx1Z2luO1xuICBjb25zdCBibG9ja3MgPSBbYmxvY2tPZihzZXR0aW5ncy50eXBEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwXSwgc2V0dGluZ3MudHlwRmxvYXRpbmdLZXlzW3R5cF0sIG51bGwpXTtcbiAgY29uc3Qgc3VidHlwTmFtZXMgPSBzdWJ0eXAgPT09IEFMTF9TVUJUWVBTID8gZ2V0U3VidHlwTmFtZXMoc2V0dGluZ3MsIHR5cCkgOiBzdWJ0eXAgPyBbc3VidHlwXSA6IFtdO1xuICBmb3IgKGNvbnN0IG5hbWUgb2Ygc3VidHlwTmFtZXMpIHtcbiAgICBjb25zdCBkYXRhID0gZ2V0U3VidHlwKHNldHRpbmdzLCB0eXAsIG5hbWUpO1xuICAgIGlmIChkYXRhKSBibG9ja3MucHVzaChibG9ja09mKGRhdGEuZnJvbnRtYXR0ZXIsIGRhdGEuZmxvYXRpbmdLZXlzLCBuYW1lKSk7XG4gIH1cbiAgcmV0dXJuIGJsb2Nrcztcbn1cblxuLy8gU2VwYXJhdGUgc2V0cyBvZiBuYW1lcyB0byBib2xkIChcInN0YW5kYXJkXCIpIGFuZCB0byBpdGFsaWNpemUgKFwiZmxvYXRpbmdcIikuXG4vLyBBIGZsb2F0aW5nIGtleSBuZXZlciBhbHNvIGNvdW50cyBhcyBzdGFuZGFyZC4gSWYgYSBrZXkgaXMgaW4gc2V2ZXJhbCBibG9ja3MsXG4vLyB0aGUgbGF0ZXIgYmxvY2sgZGVjaWRlcyAtIGZvciBhIG5vdGUgdGhhdCBpcyBpdHMgU3VidHlwIGJsb2NrLCB0aGUgc2FtZSBydWxlXG4vLyBhcyBmb3IgdGhlIHZhbHVlIGluIGdldFR5cERlZmF1bHRzIChtYWluLmpzKS5cbmZ1bmN0aW9uIHNwbGl0S2V5cyhibG9ja3MpIHtcbiAgY29uc3QgaXNGbG9hdGluZyA9IG5ldyBNYXAoKTtcbiAgZm9yIChjb25zdCB7IGtleXMsIGZsb2F0aW5nIH0gb2YgYmxvY2tzKSB7XG4gICAgZm9yIChjb25zdCBrZXkgb2Yga2V5cykgaXNGbG9hdGluZy5zZXQoa2V5LCBmbG9hdGluZy5oYXMoa2V5KSk7XG4gIH1cbiAgY29uc3Qgc3RhbmRhcmQgPSBuZXcgU2V0KCk7XG4gIGNvbnN0IGZsb2F0aW5nID0gbmV3IFNldCgpO1xuICBmb3IgKGNvbnN0IFtrZXksIGZsYWddIG9mIGlzRmxvYXRpbmcpIChmbGFnID8gZmxvYXRpbmcgOiBzdGFuZGFyZCkuYWRkKGtleSk7XG4gIHJldHVybiB7IHN0YW5kYXJkOiBzdGFuZGFyZC5zaXplID4gMCA/IHN0YW5kYXJkIDogbnVsbCwgZmxvYXRpbmc6IGZsb2F0aW5nLnNpemUgPiAwID8gZmxvYXRpbmcgOiBudWxsIH07XG59XG5cbmNvbnN0IE5PX0tFWVMgPSB7IHN0YW5kYXJkOiBudWxsLCBmbG9hdGluZzogbnVsbCB9O1xuXG5mdW5jdGlvbiBrZXlzRm9yRmlsZShwbHVnaW4sIGZpbGUpIHtcbiAgY29uc3QgeyBjb2xvclZpZXdzIH0gPSBwbHVnaW4uc2V0dGluZ3M7XG4gIGlmICghY29sb3JWaWV3cy5mcm9udG1hdHRlckRlZmF1bHRzKSByZXR1cm4gTk9fS0VZUztcbiAgY29uc3QgdHlwID0gcGx1Z2luLnR5cEluZGV4LnR5cE9mKGZpbGUpO1xuICBpZiAoIXR5cCkgcmV0dXJuIE5PX0tFWVM7XG4gIGNvbnN0IHN1YnR5cCA9IGNvbG9yVmlld3MuZnJvbnRtYXR0ZXJEZWZhdWx0c1N1YnR5cCA/IHBsdWdpbi50eXBJbmRleC5zdWJ0eXBPZihmaWxlKSA6IG51bGw7XG4gIHJldHVybiBzcGxpdEtleXMoYmxvY2tzRm9yVHlwKHBsdWdpbiwgdHlwLCBzdWJ0eXApKTtcbn1cblxuLy8gVFlQLVBhbmUgZGV0YWlsIGVkaXRvcnM6IG9uZSBlZGl0b3IgcGVyIGJsb2NrIChzZWUgdHlwU3RvcmUvc3VidHlwU3RvcmUgaW5cbi8vIHR5cC1mcm9udG1hdHRlci1lZGl0b3IuanMpLCBzbyB0aGUgbWFya3Mgc2hvdyBleGFjdGx5IHRoYXQgYmxvY2sncyBrZXlzLlxuLy8gU3VidHlwIGJsb2NrcyBvbmx5IHdpdGggdGhlIFwiU3VidHlwXCIgc3ViLXRvZ2dsZS5cbmZ1bmN0aW9uIGtleXNGb3JTdG9yZShwbHVnaW4sIHN0b3JlKSB7XG4gIGNvbnN0IHsgY29sb3JWaWV3cyB9ID0gcGx1Z2luLnNldHRpbmdzO1xuICBpZiAoIWNvbG9yVmlld3MuZnJvbnRtYXR0ZXJEZWZhdWx0cyB8fCAhc3RvcmUpIHJldHVybiBOT19LRVlTO1xuICBpZiAoc3RvcmUuc3VidHlwICYmICFjb2xvclZpZXdzLmZyb250bWF0dGVyRGVmYXVsdHNTdWJ0eXApIHJldHVybiBOT19LRVlTO1xuICByZXR1cm4gc3BsaXRLZXlzKFtibG9ja09mKHN0b3JlLmdldEZyb250bWF0dGVyKCksIHN0b3JlLmdldEZsb2F0aW5nKCkpXSk7XG59XG5cbi8vIFByb3BlcnR5IG5hbWUgKGxvd2VyY2FzZSkgLT4geyB0eXBzLCBhbGxGbG9hdGluZyB9IGFjcm9zcyBldmVyeSBUWVAgd2hvc2Vcbi8vIGZyb250bWF0dGVyIChvcHRpb25hbGx5IHdpdGggaXRzIFN1YnR5cCBibG9ja3MpIGhhcyBpdC4gXCJBbGwgcHJvcGVydGllc1wiIGlzXG4vLyB2YXVsdC13aWRlIHdpdGggbm8gc2luZ2xlIFRZUCBjb250ZXh0LCBzbyB0aGUgZnVsbCBtYXBwaW5nIGlzIGNvbGxlY3RlZCB0b1xuLy8gdGVsbCBcImV4YWN0bHkgb25lIFRZUFwiIChjb2xvcikgZnJvbSBcInNldmVyYWxcIiAoYm9sZCkuIHR5cHMgbWFwcyBUWVAgLT4gdGhlXG4vLyBibG9ja3MgaG9sZGluZyB0aGUga2V5IChudWxsID0gdGhlIFRZUC1Gcm9udG1hdHRlcik7IG9ubHkgdGhlIHVuYW1iaWd1b3VzXG4vLyBjYXNlIGdldHMgY29sb3JlZC4gYWxsRmxvYXRpbmcgaXMgdHJ1ZSBpZiB0aGUga2V5IGlzIGZsb2F0aW5nIGluIEVWRVJZIGJsb2NrXG4vLyBvZiBFVkVSWSBUWVAgLSBhbnl0aGluZyBsZXNzIHdvdWxkIG1ha2UgaXRhbGljcyBtaXNsZWFkaW5nLlxuLy9cbi8vIE93biB0b2dnbGUgKGNvbG9yVmlld3MuYWxsUHJvcGVydGllcyksIGluZGVwZW5kZW50IG9mIGZyb250bWF0dGVyRGVmYXVsdHMuXG4vLyBBIFN1YnR5cCBwcm9wZXJ0eSBjb3VudHMgZm9yIGl0cyBUWVAuXG5mdW5jdGlvbiB0eXBzVXNpbmdLZXlNYXAocGx1Z2luKSB7XG4gIGNvbnN0IG1hcCA9IG5ldyBNYXAoKTtcbiAgY29uc3QgeyBjb2xvclZpZXdzIH0gPSBwbHVnaW4uc2V0dGluZ3M7XG4gIGlmICghY29sb3JWaWV3cy5hbGxQcm9wZXJ0aWVzKSByZXR1cm4gbWFwO1xuICBjb25zdCB0eXBzID0gbmV3IFNldChbXG4gICAgLi4uT2JqZWN0LmtleXMocGx1Z2luLnNldHRpbmdzLnR5cERlZmF1bHRGcm9udG1hdHRlciksXG4gICAgLi4uKGNvbG9yVmlld3MuYWxsUHJvcGVydGllc1N1YnR5cCA/IE9iamVjdC5rZXlzKHBsdWdpbi5zZXR0aW5ncy50eXBTdWJ0eXBzID8/IHt9KSA6IFtdKSxcbiAgXSk7XG4gIGZvciAoY29uc3QgdHlwIG9mIHR5cHMpIHtcbiAgICBjb25zdCBibG9ja3MgPSBibG9ja3NGb3JUeXAocGx1Z2luLCB0eXAsIGNvbG9yVmlld3MuYWxsUHJvcGVydGllc1N1YnR5cCA/IEFMTF9TVUJUWVBTIDogbnVsbCk7XG4gICAgZm9yIChjb25zdCB7IHNlY3Rpb24sIGtleXMsIGZsb2F0aW5nIH0gb2YgYmxvY2tzKSB7XG4gICAgICBmb3IgKGNvbnN0IGtleSBvZiBrZXlzKSB7XG4gICAgICAgIGlmICghbWFwLmhhcyhrZXkpKSBtYXAuc2V0KGtleSwgeyB0eXBzOiBuZXcgTWFwKCksIGFsbEZsb2F0aW5nOiB0cnVlIH0pO1xuICAgICAgICBjb25zdCBlbnRyeSA9IG1hcC5nZXQoa2V5KTtcbiAgICAgICAgaWYgKCFlbnRyeS50eXBzLmhhcyh0eXApKSBlbnRyeS50eXBzLnNldCh0eXAsIFtdKTtcbiAgICAgICAgZW50cnkudHlwcy5nZXQodHlwKS5wdXNoKHNlY3Rpb24pO1xuICAgICAgICBlbnRyeS5hbGxGbG9hdGluZyA9IGVudHJ5LmFsbEZsb2F0aW5nICYmIGZsb2F0aW5nLmhhcyhrZXkpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICByZXR1cm4gbWFwO1xufVxuXG4vLyBNYXJrcyBvbmx5IHRoZSBuYW1lIChrZXkgaW5wdXQpLCBub3QgdGhlIHZhbHVlIC0gaW4gbm90ZXMgKGZyb250bWF0dGVyIGFuZFxuLy8gcHJvcGVydGllcyBzaWRlYmFyKSBhcyB3ZWxsIGFzIGluIHRoZSBwbHVnaW4ncyBvd24gVFlQLVBhbmUuXG5mdW5jdGlvbiBhcHBseVRvQ29udGFpbmVyKGNvbnRhaW5lckVsLCBzdGFuZGFyZEtleXMsIGZsb2F0aW5nS2V5cykge1xuICBpZiAoIWNvbnRhaW5lckVsKSByZXR1cm47XG4gIGNvbnN0IHJvd3MgPSBjb250YWluZXJFbC5xdWVyeVNlbGVjdG9yQWxsKFwiLm1ldGFkYXRhLXByb3BlcnR5W2RhdGEtcHJvcGVydHkta2V5XVwiKTtcbiAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgIGNvbnN0IGtleUVsID0gcm93LnF1ZXJ5U2VsZWN0b3IoXCIubWV0YWRhdGEtcHJvcGVydHkta2V5LWlucHV0XCIpO1xuICAgIGlmICgha2V5RWwpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHByb3BlcnR5S2V5ID0gcm93LmdldEF0dHJpYnV0ZShcImRhdGEtcHJvcGVydHkta2V5XCIpO1xuICAgIGtleUVsLmNsYXNzTGlzdC50b2dnbGUoSElHSExJR0hUX0NMQVNTLCAhIXN0YW5kYXJkS2V5cyAmJiBzdGFuZGFyZEtleXMuaGFzKHByb3BlcnR5S2V5KSk7XG4gICAga2V5RWwuY2xhc3NMaXN0LnRvZ2dsZShGTE9BVElOR19DTEFTUywgISFmbG9hdGluZ0tleXMgJiYgZmxvYXRpbmdLZXlzLmhhcyhwcm9wZXJ0eUtleSkpO1xuICB9XG59XG5cbi8vIFwiQWxsIHByb3BlcnRpZXNcIiBkb2Vzbid0IHVzZSB0aGUgbWV0YWRhdGEgd2lkZ2V0IGJ1dCBpdHMgb3duIHRyZWUgaXRlbXMsXG4vLyByZWFjaGFibGUgdmlhIHZpZXcuZG9tcyAobmFtZSAtPiBjb21wb25lbnQpOyB0aGVpciB0aXRsZSBlbGVtZW50IGlzXG4vLyAudHJlZS1pdGVtLWlubmVyLXRleHQuXG4vL1xuLy8gT25lIFRZUCB1c2luZyB0aGUgcHJvcGVydHk6IHRoZSBuYW1lIGdldHMgdGhhdCBUWVAncyBjb2xvci4gU2V2ZXJhbDogYVxuLy8gc2luZ2xlIGNvbG9yIHdvdWxkIG1pc2xlYWQsIHNvIGJvbGQgaW5zdGVhZCAoc2FtZSBtYXJrIGFzIGluIGEgbm90ZSkuXG5mdW5jdGlvbiBhcHBseVRvQWxsUHJvcGVydGllc1ZpZXcocGx1Z2luKSB7XG4gIGNvbnN0IHVzYWdlTWFwID0gdHlwc1VzaW5nS2V5TWFwKHBsdWdpbik7XG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoQUxMX1BST1BFUlRJRVNfVklFV19UWVBFKSkge1xuICAgIGNvbnN0IGRvbXMgPSBsZWFmLnZpZXc/LmRvbXM7XG4gICAgaWYgKCFkb21zKSBjb250aW51ZTtcbiAgICBmb3IgKGNvbnN0IFtrZXksIGRvbV0gb2YgT2JqZWN0LmVudHJpZXMoZG9tcykpIHtcbiAgICAgIGNvbnN0IHRpdGxlRWwgPSBkb20/LnRpdGxlRWw7XG4gICAgICBpZiAoIXRpdGxlRWwpIGNvbnRpbnVlO1xuXG4gICAgICBjb25zdCBlbnRyeSA9IHVzYWdlTWFwLmdldChrZXkudG9Mb3dlckNhc2UoKSk7XG4gICAgICBjb25zdCB0eXBzID0gZW50cnk/LnR5cHM7XG4gICAgICBjb25zdCBjb3VudCA9IHR5cHMgPyB0eXBzLnNpemUgOiAwO1xuICAgICAgdGl0bGVFbC5jbGFzc0xpc3QudG9nZ2xlKEhJR0hMSUdIVF9DTEFTUywgY291bnQgPiAxKTtcblxuICAgICAgLy8gSXRhbGljIGFzIHNvb24gYXMgaXQgaXMgZmxvYXRpbmcgRVZFUllXSEVSRS4gVW5saWtlIGJvbGQgdGhpcyBpc24ndFxuICAgICAgLy8gbGltaXRlZCB0byBvbmUgVFlQLCBzbyBib3RoIGNhbiBhcHBseSBhdCBvbmNlLlxuICAgICAgdGl0bGVFbC5jbGFzc0xpc3QudG9nZ2xlKEZMT0FUSU5HX0NMQVNTLCBjb3VudCA+IDAgJiYgZW50cnkuYWxsRmxvYXRpbmcpO1xuXG4gICAgICAvLyBXaXRoIFwiU3VidHlwXCIsIHRoZSBjb2xvciBvZiB0aGUgU3VidHlwIGJsb2NrIHRoZSBwcm9wZXJ0eSBjb21lcyBmcm9tIC1cbiAgICAgIC8vIGJ1dCBvbmx5IGlmIGV4YWN0bHkgb25lIGJsb2NrIG9mIHRoYXQgVFlQIGhhcyBpdC4gT3RoZXJ3aXNlIHRoZSBjaG9pY2VcbiAgICAgIC8vIHdvdWxkIGJlIGFyYml0cmFyeSBhbmQgY2hhbmdlIHdpdGggYmxvY2sgb3JkZXIsIHNvIHRoZSBUWVAgY29sb3JcbiAgICAgIC8vIChzdWJ0eXBDb2xvciB3aXRoIG51bGwpIGlzIHVzZWQuXG4gICAgICBpZiAoY291bnQgPT09IDEpIHtcbiAgICAgICAgY29uc3QgW1tvbmx5VHlwLCBzZWN0aW9uc11dID0gdHlwcztcbiAgICAgICAgY29uc3QgY29sb3IgPSBwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5hbGxQcm9wZXJ0aWVzU3VidHlwXG4gICAgICAgICAgPyBzdWJ0eXBDb2xvcihwbHVnaW4uc2V0dGluZ3MsIG9ubHlUeXAsIHNlY3Rpb25zLmxlbmd0aCA9PT0gMSA/IHNlY3Rpb25zWzBdIDogbnVsbClcbiAgICAgICAgICA6IHBsdWdpbi5zZXR0aW5ncy50eXBDb2xvcnNbb25seVR5cF07XG4gICAgICAgIC8vICFpbXBvcnRhbnQsIGJlY2F1c2UgdGhlIGJvbGQgcnVsZSBpbiBzdHlsZXMuY3NzIGFsc28gc2V0cyBjb2xvclxuICAgICAgICAvLyAhaW1wb3J0YW50IGFuZCBjb3VsZCBzdGlsbCBiZSBhdHRhY2hlZCBmcm9tIGFuIGVhcmxpZXIgc3RhdGUuXG4gICAgICAgIHNldElubGluZUNvbG9yKHRpdGxlRWwsIGNvbG9yLCBcImltcG9ydGFudFwiKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNldElubGluZUNvbG9yKHRpdGxlRWwsIG51bGwpO1xuICAgICAgfVxuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBhcHBseUZyb250bWF0dGVyRGVmYXVsdEhpZ2hsaWdodChwbHVnaW4pIHtcbiAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcIm1hcmtkb3duXCIpKSB7XG4gICAgY29uc3QgdmlldyA9IGxlYWYudmlldztcbiAgICBjb25zdCB7IHN0YW5kYXJkLCBmbG9hdGluZyB9ID0ga2V5c0ZvckZpbGUocGx1Z2luLCB2aWV3Py5maWxlKTtcbiAgICBhcHBseVRvQ29udGFpbmVyKHZpZXc/Lm1ldGFkYXRhRWRpdG9yPy5jb250YWluZXJFbCwgc3RhbmRhcmQsIGZsb2F0aW5nKTtcbiAgfVxuXG4gIC8vIFRoZSBwcm9wZXJ0aWVzIHNpZGViYXIgYWx3YXlzIHNob3dzIHRoZSBhY3RpdmUgZmlsZSBidXQga2VlcHMgbm8gcmVsaWFibGVcbiAgLy8gcmVmZXJlbmNlIHRvIGl0LCBoZW5jZSB0aGUgZmFsbGJhY2sgdG8gdGhlIHdvcmtzcGFjZSdzIGFjdGl2ZSBmaWxlLlxuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFwiZmlsZS1wcm9wZXJ0aWVzXCIpKSB7XG4gICAgY29uc3QgdmlldyA9IGxlYWYudmlldztcbiAgICBjb25zdCBmaWxlID0gdmlldz8uZmlsZSA/PyBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVGaWxlKCk7XG4gICAgY29uc3QgeyBzdGFuZGFyZCwgZmxvYXRpbmcgfSA9IGtleXNGb3JGaWxlKHBsdWdpbiwgZmlsZSk7XG4gICAgYXBwbHlUb0NvbnRhaW5lcih2aWV3Py5tZXRhZGF0YUVkaXRvcj8uY29udGFpbmVyRWwsIHN0YW5kYXJkLCBmbG9hdGluZyk7XG4gIH1cblxuICAvLyBUaGUgVFlQLVBhbmU6IGVhY2ggZWRpdG9yIHNob3dzIGV4YWN0bHkgb25lIGJsb2NrIChUWVAgb3IgU3VidHlwKS5cbiAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShWSUVXX1RZUEVfVFlQX1BBTkUpKSB7XG4gICAgZm9yIChjb25zdCBlZGl0b3Igb2YgbGVhZi52aWV3Py5mcm9udG1hdHRlckVkaXRvcnMgPz8gW10pIHtcbiAgICAgIGNvbnN0IHsgc3RhbmRhcmQsIGZsb2F0aW5nIH0gPSBrZXlzRm9yU3RvcmUocGx1Z2luLCBlZGl0b3Iub3duZXI/LnR5cFN0b3JlKTtcbiAgICAgIGFwcGx5VG9Db250YWluZXIoZWRpdG9yLmNvbnRhaW5lckVsLCBzdGFuZGFyZCwgZmxvYXRpbmcpO1xuICAgIH1cbiAgfVxuXG4gIGFwcGx5VG9BbGxQcm9wZXJ0aWVzVmlldyhwbHVnaW4pO1xufVxuXG5mdW5jdGlvbiByZWdpc3RlckZyb250bWF0dGVyRGVmYXVsdEhpZ2hsaWdodChwbHVnaW4pIHtcbiAgY29uc3QgcmVmcmVzaCA9ICgpID0+IGFwcGx5RnJvbnRtYXR0ZXJEZWZhdWx0SGlnaGxpZ2h0KHBsdWdpbik7XG5cbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC5tZXRhZGF0YUNhY2hlLm9uKFwiY2hhbmdlZFwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAubWV0YWRhdGFDYWNoZS5vbihcInJlc29sdmVkXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJsYXlvdXQtY2hhbmdlXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJhY3RpdmUtbGVhZi1jaGFuZ2VcIiwgcmVmcmVzaCkpO1xuXG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkocmVmcmVzaCk7XG5cbiAgLy8gQm9sZC9pdGFsaWMgbWFya3Mgd291bGQgb3RoZXJ3aXNlIHN0YXkgb24gcHJvcGVydHkgbmFtZXMgaW4gb3BlbiBub3RlcyxcbiAgLy8gdGhlIHByb3BlcnRpZXMgc2lkZWJhciBhbmQgXCJBbGwgcHJvcGVydGllc1wiIGFmdGVyIHRoZSBwbHVnaW4gaXMgZGlzYWJsZWQuXG4gIC8vIFRoZSBjb2xvciBpbiBcIkFsbCBwcm9wZXJ0aWVzXCIgZ29lcyB3aXRoIHRoZSBvdGhlciBpbmxpbmUgY29sb3JzXG4gIC8vIChjbGVhcklubGluZUNvbG9ycywgc2VlIG1haW4uanMpLlxuICBwbHVnaW4ucmVnaXN0ZXIoKCkgPT4ge1xuICAgIGZvciAoY29uc3QgZG9jIG9mIGFsbERvY3VtZW50cyhwbHVnaW4uYXBwKSkge1xuICAgICAgZm9yIChjb25zdCBlbCBvZiBkb2MucXVlcnlTZWxlY3RvckFsbChgLiR7SElHSExJR0hUX0NMQVNTfSwgLiR7RkxPQVRJTkdfQ0xBU1N9YCkpIHtcbiAgICAgICAgZWwuY2xhc3NMaXN0LnJlbW92ZShISUdITElHSFRfQ0xBU1MsIEZMT0FUSU5HX0NMQVNTKTtcbiAgICAgIH1cbiAgICB9XG4gIH0pO1xuXG4gIHJldHVybiByZWZyZXNoO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJGcm9udG1hdHRlckRlZmF1bHRIaWdobGlnaHQgfTtcbiIsICJjb25zdCB7IE5vdGljZSB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyB0eXBTdG9yZSwgc3VidHlwU3RvcmUgfSA9IHJlcXVpcmUoXCIuL3R5cC1mcm9udG1hdHRlci1lZGl0b3JcIik7XG5jb25zdCB7IGdldFN1YnR5cE5hbWVzLCBpc0VtcHR5VmFsdWUgfSA9IHJlcXVpcmUoXCIuL3N1YnR5cHNcIik7XG5jb25zdCB7IHBsdXJhbCwgam9pbkFuZCB9ID0gcmVxdWlyZShcIi4vdHlwLXV0aWxzXCIpO1xuY29uc3QgeyBUWVBfUFJPUEVSVFksIFNVQlRZUF9QUk9QRVJUWSB9ID0gcmVxdWlyZShcIi4vdHlwLWluZGV4XCIpO1xuXG4vLyBPYnNpZGlhbiBsb3dlcmNhc2VzIHByb3BlcnR5IG5hbWVzIGludGVybmFsbHksIHNvIG1hdGNoaW5nIGlnbm9yZXMgY2FzZTtcbi8vIHRoZSBuZXcgbmFtZSBpcyBrZXB0IGV4YWN0bHkgYXMgdHlwZWQuXG5mdW5jdGlvbiBzYW1lS2V5KGEsIGIpIHtcbiAgcmV0dXJuIGEudG9Mb3dlckNhc2UoKSA9PT0gYi50b0xvd2VyQ2FzZSgpO1xufVxuXG4vLyBSZW5hbWVzIG9sZEtleSBpbiBvbmUgZnJvbnRtYXR0ZXIgYmxvY2sgKFRZUCBvciBTdWJ0eXAsIHNlZSB0eXBTdG9yZS9cbi8vIHN1YnR5cFN0b3JlIGluIHR5cC1mcm9udG1hdHRlci1lZGl0b3IuanMpLCBrZWVwaW5nIGl0cyBwb3NpdGlvbiwgYW5kIG1vdmVzXG4vLyB0aGUgZmxvYXRpbmcgZmxhZyBhbG9uZy4gSWYgbmV3S2V5IGFscmVhZHkgZXhpc3RzIHRoZXJlIChhIG1lcmdlLCBsaWtlXG4vLyBPYnNpZGlhbidzIG93biBtZXJnZSBpbiB0aGUgbm90ZXMpLCB0aGUgZXhpc3RpbmcgZW50cnkga2VlcHMgaXRzIHBvc2l0aW9uXG4vLyBhbmQgb25seSB0YWtlcyB0aGUgb2xkIHZhbHVlIGlmIGl0cyBvd24gaXMgZW1wdHkuIFJldHVybnMgdHJ1ZSBvbiBhIGNoYW5nZS5cbmZ1bmN0aW9uIHJlbmFtZUluU3RvcmUoc3RvcmUsIG9sZEtleSwgbmV3S2V5KSB7XG4gIGNvbnN0IGRlZmF1bHRzID0gc3RvcmUuZ2V0RnJvbnRtYXR0ZXIoKTtcbiAgY29uc3Qga2V5cyA9IE9iamVjdC5rZXlzKGRlZmF1bHRzKTtcbiAgY29uc3Qgc291cmNlS2V5ID0ga2V5cy5maW5kKChrZXkpID0+IHNhbWVLZXkoa2V5LCBvbGRLZXkpKTtcbiAgaWYgKHNvdXJjZUtleSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gZmFsc2U7XG4gIC8vIEEgcHVyZSBjaGFuZ2Ugb2YgY2FzZSBmaW5kcyBzb3VyY2VLZXkgaXRzZWxmIGZvciBuZXdLZXkgLSBub3QgYSBtZXJnZS5cbiAgY29uc3QgdGFyZ2V0S2V5ID0ga2V5cy5maW5kKChrZXkpID0+IGtleSAhPT0gc291cmNlS2V5ICYmIHNhbWVLZXkoa2V5LCBuZXdLZXkpKTtcbiAgaWYgKHRhcmdldEtleSA9PT0gdW5kZWZpbmVkICYmIHNvdXJjZUtleSA9PT0gbmV3S2V5KSByZXR1cm4gZmFsc2U7XG5cbiAgY29uc3QgbmV4dCA9IHt9O1xuICBmb3IgKGNvbnN0IGtleSBvZiBrZXlzKSB7XG4gICAgaWYgKGtleSAhPT0gc291cmNlS2V5KSB7XG4gICAgICBuZXh0W2tleV0gPSBkZWZhdWx0c1trZXldO1xuICAgIH0gZWxzZSBpZiAodGFyZ2V0S2V5ID09PSB1bmRlZmluZWQpIHtcbiAgICAgIG5leHRbbmV3S2V5XSA9IGRlZmF1bHRzW3NvdXJjZUtleV07XG4gICAgfVxuICB9XG4gIGlmICh0YXJnZXRLZXkgIT09IHVuZGVmaW5lZCAmJiBpc0VtcHR5VmFsdWUobmV4dFt0YXJnZXRLZXldKSkgbmV4dFt0YXJnZXRLZXldID0gZGVmYXVsdHNbc291cmNlS2V5XTtcbiAgc3RvcmUuc2V0RnJvbnRtYXR0ZXIobmV4dCk7XG5cbiAgY29uc3QgZmxvYXRpbmcgPSBzdG9yZS5nZXRGbG9hdGluZygpO1xuICBpZiAoZmxvYXRpbmcubGVuZ3RoID4gMCkge1xuICAgIC8vIE9uIGEgbWVyZ2UgdGhlIHRhcmdldCdzIGZsb2F0aW5nIGZsYWcgd2lucy5cbiAgICBzdG9yZS5zZXRGbG9hdGluZyhcbiAgICAgIHRhcmdldEtleSAhPT0gdW5kZWZpbmVkXG4gICAgICAgID8gZmxvYXRpbmcuZmlsdGVyKChrZXkpID0+IGtleSAhPT0gc291cmNlS2V5KVxuICAgICAgICA6IGZsb2F0aW5nLm1hcCgoa2V5KSA9PiAoa2V5ID09PSBzb3VyY2VLZXkgPyBuZXdLZXkgOiBrZXkpKVxuICAgICk7XG4gIH1cblxuICAvLyBUaGUgc2hvcnRjdXQgYmVsb25ncyB0byB0aGUga2V5IGFuZCBtb3ZlcyB3aXRoIGl0OyBvbiBhIG1lcmdlIHRoZVxuICAvLyB0YXJnZXQncyB3aW5zLCBhcyB3aXRoIGZsb2F0aW5nLlxuICBjb25zdCBzaG9ydGN1dHMgPSB7IC4uLnN0b3JlLmdldFNob3J0Y3V0cygpIH07XG4gIGlmIChzaG9ydGN1dHNbc291cmNlS2V5XSkge1xuICAgIGlmICh0YXJnZXRLZXkgPT09IHVuZGVmaW5lZCkgc2hvcnRjdXRzW25ld0tleV0gPSBzaG9ydGN1dHNbc291cmNlS2V5XTtcbiAgICBkZWxldGUgc2hvcnRjdXRzW3NvdXJjZUtleV07XG4gICAgc3RvcmUuc2V0U2hvcnRjdXRzKHNob3J0Y3V0cyk7XG4gIH1cbiAgcmV0dXJuIHRydWU7XG59XG5cbi8vIFBpbm5lZCBlbnRyaWVzIG9mIHRoZSBnbG9iYWwgb3JkZXIgYWxsb3cgbm8gZHVwbGljYXRlcywgc28gYW4gZXhpc3Rpbmdcbi8vIHRhcmdldCBlbnRyeSBrZWVwcyBpdHMgcG9zaXRpb24gYW5kIHRoZSBvbGQgb25lIGdvZXMuXG5mdW5jdGlvbiByZW5hbWVJbkdsb2JhbE9yZGVyKHNldHRpbmdzLCBvbGRLZXksIG5ld0tleSkge1xuICBjb25zdCBvcmRlciA9IHNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXI7XG4gIGNvbnN0IHNvdXJjZSA9IG9yZGVyLmZpbmQoKGVudHJ5KSA9PiBlbnRyeS5raW5kID09PSBcInByb3BlcnR5XCIgJiYgc2FtZUtleShlbnRyeS5uYW1lLCBvbGRLZXkpKTtcbiAgaWYgKCFzb3VyY2UpIHJldHVybiBmYWxzZTtcbiAgY29uc3QgdGFyZ2V0ID0gb3JkZXIuZmluZCgoZW50cnkpID0+IGVudHJ5ICE9PSBzb3VyY2UgJiYgZW50cnkua2luZCA9PT0gXCJwcm9wZXJ0eVwiICYmIHNhbWVLZXkoZW50cnkubmFtZSwgbmV3S2V5KSk7XG4gIGlmICh0YXJnZXQpIHNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXIgPSBvcmRlci5maWx0ZXIoKGVudHJ5KSA9PiBlbnRyeSAhPT0gc291cmNlKTtcbiAgZWxzZSBpZiAoc291cmNlLm5hbWUgPT09IG5ld0tleSkgcmV0dXJuIGZhbHNlO1xuICBlbHNlIHNvdXJjZS5uYW1lID0gbmV3S2V5O1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gc3luY1JlbmFtZShwbHVnaW4sIG9sZEtleSwgbmV3S2V5KSB7XG4gIGlmICh0eXBlb2Ygb2xkS2V5ICE9PSBcInN0cmluZ1wiIHx8IHR5cGVvZiBuZXdLZXkgIT09IFwic3RyaW5nXCIpIHJldHVybjtcbiAgbmV3S2V5ID0gbmV3S2V5LnRyaW0oKTtcbiAgaWYgKG9sZEtleSA9PT0gXCJcIiB8fCBuZXdLZXkgPT09IFwiXCIgfHwgb2xkS2V5ID09PSBuZXdLZXkpIHJldHVybjtcbiAgLy8gVFlQL1NVQlRZUCBhcmUgbmV2ZXIgcGFydCBvZiBhIGJsb2NrIChzZWUgc3RyaXBUeXBQcm9wZXJ0eSBpblxuICAvLyB0eXAtZnJvbnRtYXR0ZXItZWRpdG9yLmpzKSwgc28gcmVuYW1lcyBmcm9tIG9yIHRvIHRoZW0gYXJlIGlnbm9yZWQuXG4gIGlmIChbb2xkS2V5LCBuZXdLZXldLnNvbWUoKGtleSkgPT4gc2FtZUtleShrZXksIFRZUF9QUk9QRVJUWSkgfHwgc2FtZUtleShrZXksIFNVQlRZUF9QUk9QRVJUWSkpKSByZXR1cm47XG5cbiAgY29uc3QgeyBzZXR0aW5ncyB9ID0gcGx1Z2luO1xuICBsZXQgdHlwQ291bnQgPSAwO1xuICBsZXQgc3VidHlwQ291bnQgPSAwO1xuICBjb25zdCBjb3VudCA9IChzdG9yZSkgPT4gKHN0b3JlLnN1YnR5cCA/IHN1YnR5cENvdW50KysgOiB0eXBDb3VudCsrKTtcbiAgY29uc3QgdHlwcyA9IG5ldyBTZXQoWy4uLk9iamVjdC5rZXlzKHNldHRpbmdzLnR5cERlZmF1bHRGcm9udG1hdHRlciksIC4uLk9iamVjdC5rZXlzKHNldHRpbmdzLnR5cFN1YnR5cHMgPz8ge30pXSk7XG4gIGZvciAoY29uc3QgdHlwIG9mIHR5cHMpIHtcbiAgICBjb25zdCBzdG9yZXMgPSBbdHlwU3RvcmUocGx1Z2luLCB0eXApLCAuLi5nZXRTdWJ0eXBOYW1lcyhzZXR0aW5ncywgdHlwKS5tYXAoKHN1YnR5cCkgPT4gc3VidHlwU3RvcmUocGx1Z2luLCB0eXAsIHN1YnR5cCkpXTtcblxuICAgIC8vIEEgdmF1bHQtd2lkZSByZW5hbWUgaGl0cyBFVkVSWSBibG9jayBob2xkaW5nIHRoZSBrZXkgLSB0aGUgc2FtZSBrZXkgbWF5XG4gICAgLy8gYXBwZWFyIGluIHNldmVyYWwgYmxvY2tzIChzZWUgdHlwU3VidHlwcyBpbiBzdWJ0eXBzLmpzKS4gT25seSB3aXRoaW4gb25lXG4gICAgLy8gYmxvY2sgY2FuIHRoZSBuZXcgbmFtZSBjb2xsaWRlOyByZW5hbWVJblN0b3JlIG1lcmdlcyB0aGUgdHdvIHRoZXJlLlxuICAgIGZvciAoY29uc3Qgc3RvcmUgb2Ygc3RvcmVzKSB7XG4gICAgICBpZiAocmVuYW1lSW5TdG9yZShzdG9yZSwgb2xkS2V5LCBuZXdLZXkpKSBjb3VudChzdG9yZSk7XG4gICAgfVxuICB9XG4gIGNvbnN0IG9yZGVyQ2hhbmdlZCA9IHJlbmFtZUluR2xvYmFsT3JkZXIoc2V0dGluZ3MsIG9sZEtleSwgbmV3S2V5KTtcbiAgaWYgKHR5cENvdW50ID09PSAwICYmIHN1YnR5cENvdW50ID09PSAwICYmICFvcmRlckNoYW5nZWQpIHJldHVybjtcblxuICBhd2FpdCBwbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gIHBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcblxuICBjb25zdCBwYXJ0cyA9IFtdO1xuICBpZiAodHlwQ291bnQgPiAwKSBwYXJ0cy5wdXNoKHBsdXJhbCh0eXBDb3VudCwgXCJUWVAgYmxvY2tcIikpO1xuICBpZiAoc3VidHlwQ291bnQgPiAwKSBwYXJ0cy5wdXNoKHBsdXJhbChzdWJ0eXBDb3VudCwgXCJTdWJ0eXAgYmxvY2tcIikpO1xuICBpZiAob3JkZXJDaGFuZ2VkKSBwYXJ0cy5wdXNoKFwidGhlIGdsb2JhbCBvcmRlclwiKTtcbiAgbmV3IE5vdGljZShgVFlQLVN5c3RlbTogcmVuYW1lZCBcIiR7b2xkS2V5fVwiIFx1MjE5MiBcIiR7bmV3S2V5fVwiIGluICR7am9pbkFuZChwYXJ0cyl9LmApO1xufVxuXG4vLyBPYnNpZGlhbidzIFwiQWxsIHByb3BlcnRpZXNcIiB2aWV3IGFuZCBCYXNlcyAobmFtaW5nIGEgbmV3IG5vdGUgcHJvcGVydHkpXG4vLyByZW5hbWUgcHJvcGVydGllcyB2YXVsdC13aWRlIG9ubHkgdGhyb3VnaCBhcHAuZmlsZU1hbmFnZXIucmVuYW1lUHJvcGVydHksXG4vLyBzbyB3cmFwcGluZyB0aGF0IG9uZSBtZXRob2QgY2F0Y2hlcyBldmVyeSByZWFsIHJlbmFtZS4gQmFzZXMnIFwiRGlzcGxheVxuLy8gbmFtZVwiIG9ubHkgY2hhbmdlcyB0aGUgLmJhc2UgZmlsZSwgbm90IHRoZSBub3RlcywgYW5kIHJpZ2h0bHkgZG9lc24ndCBwYXNzXG4vLyB0aHJvdWdoIGhlcmUuXG5mdW5jdGlvbiByZWdpc3RlclByb3BlcnR5UmVuYW1lU3luYyhwbHVnaW4pIHtcbiAgY29uc3QgZmlsZU1hbmFnZXIgPSBwbHVnaW4uYXBwLmZpbGVNYW5hZ2VyO1xuICBpZiAoZmlsZU1hbmFnZXIuX190eXBTeXN0ZW1SZW5hbWVTeW5jUGF0Y2hlZCkgcmV0dXJuO1xuICBmaWxlTWFuYWdlci5fX3R5cFN5c3RlbVJlbmFtZVN5bmNQYXRjaGVkID0gdHJ1ZTtcblxuICBjb25zdCBvcmlnaW5hbCA9IGZpbGVNYW5hZ2VyLnJlbmFtZVByb3BlcnR5O1xuICBmaWxlTWFuYWdlci5yZW5hbWVQcm9wZXJ0eSA9IGFzeW5jIGZ1bmN0aW9uIChvbGRLZXksIG5ld0tleSwgLi4ucmVzdCkge1xuICAgIC8vIElmIHRoZSBvcmlnaW5hbCB0aHJvd3MgKGFjY2VwdFJlbmFtZSBoYW5kbGVzIHRoYXQpLCBzZXR0aW5ncyBzdGF5IGFzXG4gICAgLy8gdGhleSBhcmUuXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgb3JpZ2luYWwuY2FsbCh0aGlzLCBvbGRLZXksIG5ld0tleSwgLi4ucmVzdCk7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHN5bmNSZW5hbWUocGx1Z2luLCBvbGRLZXksIG5ld0tleSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJUWVAtU3lzdGVtOiBwcm9wZXJ0eSByZW5hbWUgbm90IGFwcGxpZWRcIiwgZXJyb3IpO1xuICAgICAgbmV3IE5vdGljZShgVFlQLVN5c3RlbTogcmVuYW1lIG9mIFwiJHtvbGRLZXl9XCIgbm90IGFwcGxpZWQgXHUyMDEzICR7ZXJyb3IubWVzc2FnZX1gKTtcbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfTtcblxuICBwbHVnaW4ucmVnaXN0ZXIoKCkgPT4ge1xuICAgIGZpbGVNYW5hZ2VyLnJlbmFtZVByb3BlcnR5ID0gb3JpZ2luYWw7XG4gICAgZGVsZXRlIGZpbGVNYW5hZ2VyLl9fdHlwU3lzdGVtUmVuYW1lU3luY1BhdGNoZWQ7XG4gIH0pO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJQcm9wZXJ0eVJlbmFtZVN5bmMgfTtcbiIsICJjb25zdCB7IEZ1enp5U3VnZ2VzdE1vZGFsLCBOb3RpY2UsIHByZXBhcmVGdXp6eVNlYXJjaCwgcmVuZGVyTWF0Y2hlcyB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyBjb21wYXJlVHlwcywgREVGQVVMVF9TT1JUX09SREVSIH0gPSByZXF1aXJlKFwiLi90eXAtcGFuZVwiKTtcbmNvbnN0IHsgbmFtZUNvbG9yLCBwYWludENvbG9yRG90IH0gPSByZXF1aXJlKFwiLi90eXAtY29sb3JzXCIpO1xuY29uc3QgeyBwaWNrZXJJbnN0cnVjdGlvbnMgfSA9IHJlcXVpcmUoXCIuL3R5cC11dGlsc1wiKTtcblxuLy8gVGhlIHNlYXJjaCB0ZXh0IG9mIGEgVFlQIHJvdywgYXMgdGhlIHBhcnRzIHRoZSByb3cgcmVuZGVycyBzZXBhcmF0ZWx5OlxuLy8gW3sga2V5OiBcInR5cFwiIHwgXCJzdWJ0eXBzXCIgfCBcImRlc2NyaXB0aW9uXCIsIHRleHQsIHN0YXJ0IH1dLCBzdGFydCBiZWluZyB0aGVcbi8vIHBhcnQncyBwb3NpdGlvbiBpbiB0aGUgc2VhcmNoIHRleHQuIGdldEl0ZW1UZXh0IGpvaW5zIGV4YWN0bHkgdGhlc2Ugd2l0aFxuLy8gXCIgXCIsIHNvIHRoaXMgaXMgdGhlIG9uZSBwbGFjZSB0aGF0IGRlZmluZXMgaXQgLSB0aGUgbWF0Y2ggcmFuZ2VzIE9ic2lkaWFuXG4vLyByZXR1cm5zIHJlZmVyIHRvIHRoZSBqb2luZWQgdGV4dCBhbmQgYXJlIHNwbGl0IGJhY2sgb250byB0aGUgcGFydHMgYnlcbi8vIHN0YXJ0IChzZWUgaGlnaGxpZ2h0KS4gVGhlIFN1YnR5cCBuYW1lcyBhcmUgb25lIHBhcnQsIGpvaW5lZCB3aXRoIFwiIFwiIGFzIGluXG4vLyB0aGUgc2VhcmNoIHRleHQsIHRob3VnaCB0aGUgcm93IHNob3dzIHRoZW0gd2l0aCBcIiwgXCIuXG5mdW5jdGlvbiB0ZXh0UGFydHMoaXRlbSkge1xuICBjb25zdCBwYXJ0cyA9IFtdO1xuICBsZXQgc3RhcnQgPSAwO1xuICBjb25zdCBhZGQgPSAoa2V5LCB0ZXh0KSA9PiB7XG4gICAgaWYgKCF0ZXh0KSByZXR1cm47XG4gICAgcGFydHMucHVzaCh7IGtleSwgdGV4dCwgc3RhcnQgfSk7XG4gICAgc3RhcnQgKz0gdGV4dC5sZW5ndGggKyAxO1xuICB9O1xuICBhZGQoXCJ0eXBcIiwgaXRlbS50eXApO1xuICBhZGQoXCJzdWJ0eXBzXCIsIGl0ZW0uc3VidHlwcz8uam9pbihcIiBcIikpO1xuICBhZGQoXCJkZXNjcmlwdGlvblwiLCBpdGVtLmRlc2NyaXB0aW9uKTtcbiAgcmV0dXJuIHBhcnRzO1xufVxuXG4vLyBXcml0ZXMgdGV4dCBpbnRvIGVsIHdpdGggdGhlIG1hdGNoZWQgY2hhcmFjdGVycyBtYXJrZWQgbGlrZSBpbiBPYnNpZGlhbidzXG4vLyBvd24gc3VnZ2VzdGVycyAoLnN1Z2dlc3Rpb24taGlnaGxpZ2h0KS4gc3RhcnQgaXMgdGhlIHRleHQncyBwb3NpdGlvbiBpbiB0aGVcbi8vIHdob2xlIHNlYXJjaCB0ZXh0OyByZW5kZXJNYXRjaGVzIHNoaWZ0cyBldmVyeSByYW5nZSBieSBpdHMgb2Zmc2V0IGFuZFxuLy8gY2xpcHMgd2hhdCBmYWxscyBvdXRzaWRlLCBzbyAtc3RhcnQgbWFwcyB0aGUgcmFuZ2VzIG9udG8gdGhpcyBwYXJ0LlxuZnVuY3Rpb24gaGlnaGxpZ2h0KGVsLCB0ZXh0LCBtYXRjaGVzLCBzdGFydCA9IDApIHtcbiAgcmVuZGVyTWF0Y2hlcyhlbCwgdGV4dCwgbWF0Y2hlcz8ubGVuZ3RoID8gbWF0Y2hlcyA6IG51bGwsIC1zdGFydCk7XG59XG5cbi8vIE5hdGl2ZSByZXBsYWNlbWVudCBmb3IgVGVtcGxhdGVyJ3MgdHAuc3lzdGVtLnN1Z2dlc3RlciB3aGVuIGNob29zaW5nIGEgVFlQXG4vLyAoc2VlIF9vYnNpZGlhbi90ZW1wbGF0ZXItc2NyaXB0cy9UWVAuanMpLCBidWlsdCBvbiBPYnNpZGlhbidzXG4vLyBGdXp6eVN1Z2dlc3RNb2RhbCBsaWtlIFRlbXBsYXRlcidzIG93biwgYnV0IHNob3dpbmcgY29sb3Igb3IgZG90LFxuLy8gZGVzY3JpcHRpb24gYW5kIG5vdGUgY291bnQgcGVyIHJvdy4gVW5yZWdpc3RlcmVkIGVudHJpZXMgYXJlIG11dGVkLCBhcyBpblxuLy8gdGhlIFRZUC1MaXN0LlxuY2xhc3MgVHlwUGlja2VyTW9kYWwgZXh0ZW5kcyBGdXp6eVN1Z2dlc3RNb2RhbCB7XG4gIGNvbnN0cnVjdG9yKGFwcCwgcGx1Z2luLCBpdGVtcywgcmVzb2x2ZSkge1xuICAgIHN1cGVyKGFwcCk7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gICAgdGhpcy5pdGVtcyA9IGl0ZW1zO1xuICAgIHRoaXMucmVzb2x2ZSA9IHJlc29sdmU7XG4gICAgdGhpcy5jaG9zZW4gPSBmYWxzZTtcbiAgICB0aGlzLnNldFBsYWNlaG9sZGVyKFwiQ2hvb3NlIFRZUFx1MjAyNlwiKTtcbiAgICB0aGlzLnNldEluc3RydWN0aW9ucyhwaWNrZXJJbnN0cnVjdGlvbnMoKSk7XG4gIH1cblxuICBnZXRJdGVtcygpIHtcbiAgICByZXR1cm4gdGhpcy5pdGVtcztcbiAgfVxuXG4gIC8vIFNlYXJjaCBhbHNvIGNvdmVycyB0aGUgZGVzY3JpcHRpb24gYW5kLCB3aGVyZSBzaG93biBpbiB0aGUgcm93XG4gIC8vIChzaG93U3VidHlwcyksIHRoZSBTdWJ0eXAgbmFtZXM6IHdoYXQgeW91IHNlZSB5b3UgZXhwZWN0IHRvIGJlIGFibGUgdG8gdHlwZS5cbiAgZ2V0SXRlbVRleHQoaXRlbSkge1xuICAgIHJldHVybiB0ZXh0UGFydHMoaXRlbSlcbiAgICAgIC5tYXAoKHBhcnQpID0+IHBhcnQudGV4dClcbiAgICAgIC5qb2luKFwiIFwiKTtcbiAgfVxuXG4gIHJlbmRlclN1Z2dlc3Rpb24obWF0Y2gsIGVsKSB7XG4gICAgY29uc3QgaXRlbSA9IG1hdGNoLml0ZW07XG4gICAgY29uc3QgbWF0Y2hlcyA9IG1hdGNoLm1hdGNoPy5tYXRjaGVzID8/IFtdO1xuICAgIGNvbnN0IHBhcnRzID0gT2JqZWN0LmZyb21FbnRyaWVzKHRleHRQYXJ0cyhpdGVtKS5tYXAoKHBhcnQpID0+IFtwYXJ0LmtleSwgcGFydF0pKTtcbiAgICBlbC5hZGRDbGFzcyhcInR5cC1waWNrZXItc3VnZ2VzdGlvblwiKTtcbiAgICBpZiAoaXRlbS51bnJlZ2lzdGVyZWQpIGVsLmFkZENsYXNzKFwidHlwLXBpY2tlci11bnJlZ2lzdGVyZWRcIik7XG5cbiAgICBpZiAoaXRlbS51bnJlZ2lzdGVyZWQpIHtcbiAgICAgIGhpZ2hsaWdodChlbC5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1waWNrZXItbmFtZVwiIH0pLCBpdGVtLnR5cCwgbWF0Y2hlcyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMucmVuZGVyQ29sb3JlZE5hbWUoZWwsIGl0ZW0udHlwLCBpdGVtLnR5cCwgbnVsbCwgbWF0Y2hlcyk7XG4gICAgfVxuXG4gICAgaWYgKGl0ZW0uc3VidHlwcz8ubGVuZ3RoKSB0aGlzLnJlbmRlclN1YnR5cFByZXZpZXcoZWwsIGl0ZW0sIG1hdGNoZXMsIHBhcnRzLnN1YnR5cHMuc3RhcnQpO1xuXG4gICAgaWYgKGl0ZW0uZGVzY3JpcHRpb24pIHtcbiAgICAgIGhpZ2hsaWdodChlbC5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1waWNrZXItZGVzY1wiIH0pLCBpdGVtLmRlc2NyaXB0aW9uLCBtYXRjaGVzLCBwYXJ0cy5kZXNjcmlwdGlvbi5zdGFydCk7XG4gICAgfVxuXG4gICAgZWwuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtcGlja2VyLWNvdW50XCIsIHRleHQ6IFN0cmluZyhpdGVtLmNvdW50KSB9KTtcbiAgfVxuXG4gIC8vIE5hbWUgaW4gdGhlIGNvbG9yIG9mIGNvbG9yVHlwIChvciBvZiB0aGUgU3VidHlwLCBzZWUgbmFtZUNvbG9yIGluXG4gIC8vIHR5cC1jb2xvcnMuanMpIC0gYXMgY29sb3JlZCB0ZXh0IG9yIHdpdGggYSBkb3QgYmVmb3JlIGl0LCBkZXBlbmRpbmcgb25cbiAgLy8gdGhlIFwiVFlQLVBhbmVcIiBjb2xvcmluZyBzZXR0aW5nLiBtYXRjaGVzL3N0YXJ0IGFzIGluIGhpZ2hsaWdodCgpLlxuICByZW5kZXJDb2xvcmVkTmFtZShlbCwgdGV4dCwgY29sb3JUeXAsIHN1YnR5cCA9IG51bGwsIG1hdGNoZXMgPSBbXSwgc3RhcnQgPSAwKSB7XG4gICAgY29uc3QgeyBjb2xvciwgaXNEZWZhdWx0IH0gPSBuYW1lQ29sb3IodGhpcy5wbHVnaW4uc2V0dGluZ3MsIGNvbG9yVHlwLCBzdWJ0eXApO1xuICAgIGNvbnN0IGNvbG9yaXplID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0O1xuICAgIGlmICghY29sb3JpemUpIHBhaW50Q29sb3JEb3QoZWwuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtcGlja2VyLWRvdFwiIH0pLCBjb2xvciwgaXNEZWZhdWx0KTtcbiAgICBjb25zdCBuYW1lRWwgPSBlbC5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1waWNrZXItbmFtZVwiIH0pO1xuICAgIGlmIChjb2xvcml6ZSkgbmFtZUVsLnN0eWxlLmNvbG9yID0gY29sb3I7XG4gICAgaGlnaGxpZ2h0KG5hbWVFbCwgdGV4dCwgbWF0Y2hlcywgc3RhcnQpO1xuICB9XG5cbiAgLy8gXCJUWVAgKFN1YnR5cCAxLCBTdWJ0eXAgMilcIiAtIHNob3dzIHdoYXQgbGllcyBiZWxvdyB0aGUgVFlQIGJlZm9yZSB0aGVcbiAgLy8gc2VwYXJhdGUgU3VidHlwLVBpY2tlciBjb21lcy4gRWFjaCBTdWJ0eXAgaW4gaXRzIG93biBjb2xvciwgYnJhY2tldHMgYW5kXG4gIC8vIGNvbW1hcyBtdXRlZDsgdW5jb2xvcmVkIGxpa2UgdGhlIG5hbWUgd2hlbiBcIlRZUC1QYW5lXCIgY29sb3JpbmcgaXMgb2ZmLlxuICAvLyBzdGFydCBpcyB3aGVyZSB0aGUgU3VidHlwIG5hbWVzIGJlZ2luIGluIHRoZSBzZWFyY2ggdGV4dDsgdGhlcmUgdGhleSBhcmVcbiAgLy8gc2VwYXJhdGVkIGJ5IG9uZSBzcGFjZSBpbnN0ZWFkIG9mIFwiLCBcIiwgc28gZWFjaCBuYW1lIHN0YXJ0cyBvbmUgY2hhcmFjdGVyXG4gIC8vIGFmdGVyIHRoZSBlbmQgb2YgdGhlIG9uZSBiZWZvcmUuXG4gIHJlbmRlclN1YnR5cFByZXZpZXcoZWwsIGl0ZW0sIG1hdGNoZXMgPSBbXSwgc3RhcnQgPSAwKSB7XG4gICAgY29uc3QgY29sb3JpemUgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnR5cExpc3Q7XG4gICAgY29uc3Qgd3JhcCA9IGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLXBpY2tlci1zdWJ0eXBzXCIgfSk7XG4gICAgd3JhcC5hcHBlbmRUZXh0KFwiKFwiKTtcbiAgICBsZXQgcG9zaXRpb24gPSBzdGFydDtcbiAgICBpdGVtLnN1YnR5cHMuZm9yRWFjaCgoc3VidHlwLCBpbmRleCkgPT4ge1xuICAgICAgaWYgKGluZGV4ID4gMCkgd3JhcC5hcHBlbmRUZXh0KFwiLCBcIik7XG4gICAgICBjb25zdCBzcGFuID0gd3JhcC5jcmVhdGVTcGFuKCk7XG4gICAgICBoaWdobGlnaHQoc3Bhbiwgc3VidHlwLCBtYXRjaGVzLCBwb3NpdGlvbik7XG4gICAgICBwb3NpdGlvbiArPSBzdWJ0eXAubGVuZ3RoICsgMTtcbiAgICAgIGlmIChjb2xvcml6ZSkgc3Bhbi5zdHlsZS5jb2xvciA9IG5hbWVDb2xvcih0aGlzLnBsdWdpbi5zZXR0aW5ncywgaXRlbS50eXAsIHN1YnR5cCkuY29sb3I7XG4gICAgfSk7XG4gICAgd3JhcC5hcHBlbmRUZXh0KFwiKVwiKTtcbiAgfVxuXG4gIC8vIE9ic2lkaWFuJ3Mgc2VsZWN0U3VnZ2VzdGlvbigpIGNhbGxzIGNsb3NlKCkgQkVGT1JFIG9uQ2hvb3NlSXRlbSgpLiBTZXRcbiAgLy8gXCJjaG9zZW5cIiBhbnkgbGF0ZXIgYW5kIG9uQ2xvc2UoKSByZXNvbHZlcyB3aXRoIG51bGwgZmlyc3QgLSBhIHByb21pc2Ugb25seVxuICAvLyByZXNvbHZlcyBvbmNlLCBzbyBldmVyeSBjaG9pY2Ugd291bGQgY29tZSBiYWNrIGFzIG51bGwuXG4gIHNlbGVjdFN1Z2dlc3Rpb24oaXRlbSwgZXZ0KSB7XG4gICAgdGhpcy5jaG9zZW4gPSB0cnVlO1xuICAgIC8vIFdoYXQgd2FzIHR5cGVkIHdoZW4gY2hvb3Npbmc7IHRoZSBTdWJ0eXAtUGlja2VyIHNvcnRzIGJ5IGl0IChzZWVcbiAgICAvLyBwaWNrVHlwRW50cnkvc29ydEJ5UXVlcnkpLlxuICAgIHRoaXMucXVlcnkgPSB0aGlzLmlucHV0RWwudmFsdWUudHJpbSgpO1xuICAgIHN1cGVyLnNlbGVjdFN1Z2dlc3Rpb24oaXRlbSwgZXZ0KTtcbiAgfVxuXG4gIG9uQ2hvb3NlSXRlbShpdGVtKSB7XG4gICAgdGhpcy5yZXNvbHZlKGl0ZW0udHlwKTtcbiAgfVxuXG4gIC8vIEVTQyBvciBhIGNsaWNrIG91dHNpZGUgY2xvc2VzIHdpdGhvdXQgc2VsZWN0U3VnZ2VzdGlvbjogcmVzb2x2ZSB3aXRoIG51bGxcbiAgLy8gaW5zdGVhZCBvZiBsZWF2aW5nIHRoZSBwcm9taXNlIGhhbmdpbmcsIGxpa2UgdHAuc3lzdGVtLnN1Z2dlc3Rlci5cbiAgb25DbG9zZSgpIHtcbiAgICBzdXBlci5vbkNsb3NlKCk7XG4gICAgaWYgKCF0aGlzLmNob3NlbikgdGhpcy5yZXNvbHZlKG51bGwpO1xuICB9XG59XG5cbi8vIFBpY2tzIGEgU3VidHlwIGZvciBhbiBhbHJlYWR5IGNob3NlbiBUWVAgKHNlZSBwaWNrU3VidHlwKS4gTGlrZVxuLy8gVHlwUGlja2VyTW9kYWwsIHBsdXMgYSBmaXJzdCByb3cgXCJUWVAgKG5vIFN1YnR5cClcIiAoaXRlbS5ub25lKS4gRVNDIHJlc29sdmVzXG4vLyB3aXRoIG51bGwsIGFuZCBUWVAuanMgZ29lcyBiYWNrIHRvIHRoZSBUWVAgY2hvaWNlLiBxdWVyeSBpcyB0aGUgc2VhcmNoIGZyb21cbi8vIHRoZSBUWVAtUGlja2VyIHRoYXQgcHJlLXNvcnRzIHRoZSBsaXN0LlxuY2xhc3MgU3VidHlwUGlja2VyTW9kYWwgZXh0ZW5kcyBUeXBQaWNrZXJNb2RhbCB7XG4gIGNvbnN0cnVjdG9yKGFwcCwgcGx1Z2luLCB0eXAsIGl0ZW1zLCByZXNvbHZlLCBxdWVyeSA9IFwiXCIpIHtcbiAgICBzdXBlcihhcHAsIHBsdWdpbiwgaXRlbXMsIHJlc29sdmUpO1xuICAgIHRoaXMudHlwID0gdHlwO1xuICAgIHRoaXMuc2V0UGxhY2Vob2xkZXIoYENob29zZSBTdWJ0eXAgZm9yICR7dHlwfVx1MjAyNmApO1xuICAgIHRoaXMuc2V0SW5zdHJ1Y3Rpb25zKHBpY2tlckluc3RydWN0aW9ucyhcInRvIGdvIGJhY2tcIikpO1xuICAgIHRoaXMuaXRlbXMgPSBzb3J0QnlRdWVyeShpdGVtcywgcXVlcnksIChpdGVtKSA9PiB0aGlzLmdldEl0ZW1UZXh0KGl0ZW0pKTtcbiAgfVxuXG4gIC8vIFRoZSBcIm5vIFN1YnR5cFwiIHJvdyBpcyBhbHNvIGZvdW5kIGJ5IHRoZSBUWVAgbmFtZSBpdCBzaG93cywgc28gXCJPUkdBXCJcbiAgLy8gdHlwZWQgaW4gdGhlIFRZUC1QaWNrZXIgYnJpbmdzIGl0IGJhY2sgdG8gdGhlIHRvcC5cbiAgZ2V0SXRlbVRleHQoaXRlbSkge1xuICAgIHJldHVybiBpdGVtLm5vbmUgPyBgJHt0aGlzLnR5cH0gJHtpdGVtLnR5cH1gIDogc3VwZXIuZ2V0SXRlbVRleHQoaXRlbSk7XG4gIH1cblxuICByZW5kZXJTdWdnZXN0aW9uKG1hdGNoLCBlbCkge1xuICAgIGNvbnN0IGl0ZW0gPSBtYXRjaC5pdGVtO1xuICAgIGNvbnN0IG1hdGNoZXMgPSBtYXRjaC5tYXRjaD8ubWF0Y2hlcyA/PyBbXTtcbiAgICBlbC5hZGRDbGFzcyhcInR5cC1waWNrZXItc3VnZ2VzdGlvblwiKTtcbiAgICBpZiAoaXRlbS5ub25lKSB7XG4gICAgICAvLyBcIk9SR0EgKG5vIFN1YnR5cClcIjogdGhlIFRZUCBpbiBpdHMgY29sb3IsIHRoZSBzdWZmaXggaW4gbm9ybWFsIHRleHRcbiAgICAgIC8vIGNvbG9yIHJhdGhlciB0aGFuIG11dGVkIC0gaXQgaXMgYSByZWFsIGNob2ljZSwgbm90IGEgZ3JheWVkLW91dFxuICAgICAgLy8gbm9uLWNob2ljZSwgYW5kIGl0IHN0YW5kcyBhcGFydCBmcm9tIHRoZSBTdWJ0eXAgcm93cyBiZWxvdy4gVGhlXG4gICAgICAvLyBzZWFyY2ggdGV4dCBpcyBcIk9SR0Egbm8gU3VidHlwXCIgKHNlZSBnZXRJdGVtVGV4dCksIHNvIHRoZSBzdWZmaXhcbiAgICAgIC8vIHN0YXJ0cyBvbmUgY2hhcmFjdGVyIGFmdGVyIHRoZSBUWVAgbmFtZS5cbiAgICAgIHRoaXMucmVuZGVyQ29sb3JlZE5hbWUoZWwsIHRoaXMudHlwLCB0aGlzLnR5cCwgbnVsbCwgbWF0Y2hlcyk7XG4gICAgICBjb25zdCBub25lRWwgPSBlbC5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1waWNrZXItbm9uZVwiIH0pO1xuICAgICAgbm9uZUVsLmFwcGVuZFRleHQoXCIoXCIpO1xuICAgICAgaGlnaGxpZ2h0KG5vbmVFbCwgaXRlbS50eXAsIG1hdGNoZXMsIHRoaXMudHlwLmxlbmd0aCArIDEpO1xuICAgICAgbm9uZUVsLmFwcGVuZFRleHQoXCIpXCIpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnJlbmRlckNvbG9yZWROYW1lKGVsLCBpdGVtLnR5cCwgdGhpcy50eXAsIGl0ZW0udHlwLCBtYXRjaGVzKTtcbiAgICB9XG4gICAgZWwuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtcGlja2VyLWNvdW50XCIsIHRleHQ6IFN0cmluZyhpdGVtLmNvdW50KSB9KTtcbiAgfVxuXG4gIG9uQ2hvb3NlSXRlbShpdGVtKSB7XG4gICAgdGhpcy5yZXNvbHZlKGl0ZW0ubm9uZSA/IFwiXCIgOiBpdGVtLnR5cCk7XG4gIH1cbn1cblxuLy8gVFlQLVBpY2tlciB3aXRoIGVhY2ggU3VidHlwIGluZGVudGVkIGJlbG93IGl0cyBUWVAgKHRoZSBkZWZhdWx0IHdoaWxlXG4vLyBcIlNlcGFyYXRlIFN1YnR5cC1QaWNrZXJcIiBpcyBvZmYsIHNlZSBwaWNrVHlwQW5kU3VidHlwKS4gVGhlIFRZUCByb3cgaXRzZWxmXG4vLyBtZWFucyBcIm5vIFN1YnR5cFwiLiBTZWFyY2ggd29ya3MgcGVyIGdyb3VwIHNvIGEgU3VidHlwIG5ldmVyIGFwcGVhcnMgd2l0aG91dFxuLy8gaXRzIFRZUDogYSBUWVAgbWF0Y2gga2VlcHMgYWxsIGl0cyBTdWJ0eXBzLCBhIFN1YnR5cCBtYXRjaCBrZWVwcyB0aGF0IFN1YnR5cFxuLy8gd2l0aCBpdHMgVFlQLiBHcm91cHMgc29ydCBieSB0aGVpciBiZXN0IG1hdGNoOyB3aXRoaW4gYSBncm91cCBibG9jayBvcmRlclxuLy8gc3RheXMuXG5jbGFzcyBUeXBTdWJ0eXBQaWNrZXJNb2RhbCBleHRlbmRzIFR5cFBpY2tlck1vZGFsIHtcbiAgY29uc3RydWN0b3IoYXBwLCBwbHVnaW4sIGdyb3VwcywgcmVzb2x2ZSkge1xuICAgIHN1cGVyKGFwcCwgcGx1Z2luLCBncm91cHMubWFwKChncm91cCkgPT4gZ3JvdXAuaXRlbSksIHJlc29sdmUpO1xuICAgIHRoaXMuZ3JvdXBzID0gZ3JvdXBzO1xuICAgIHRoaXMuc2V0UGxhY2Vob2xkZXIoXCJDaG9vc2UgVFlQIG9yIFN1YnR5cFx1MjAyNlwiKTtcbiAgfVxuXG4gIGdldFN1Z2dlc3Rpb25zKHF1ZXJ5KSB7XG4gICAgY29uc3Qgc2VhcmNoID0gcXVlcnkudHJpbSgpID8gcHJlcGFyZUZ1enp5U2VhcmNoKHF1ZXJ5LnRyaW0oKSkgOiBudWxsO1xuICAgIGNvbnN0IG5vTWF0Y2ggPSB7IHNjb3JlOiAwLCBtYXRjaGVzOiBbXSB9O1xuICAgIGNvbnN0IHJlc3VsdHMgPSBbXTtcbiAgICBmb3IgKGNvbnN0IHsgaXRlbSwgc3VidHlwcyB9IG9mIHRoaXMuZ3JvdXBzKSB7XG4gICAgICBjb25zdCB0eXBNYXRjaCA9IHNlYXJjaCA/IHNlYXJjaCh0aGlzLmdldEl0ZW1UZXh0KGl0ZW0pKSA6IG5vTWF0Y2g7XG4gICAgICBsZXQgc3VidHlwTWF0Y2hlcyA9IHN1YnR5cHMubWFwKChzdWJ0eXApID0+ICh7IGl0ZW06IHN1YnR5cCwgbWF0Y2g6IHNlYXJjaCA/IHNlYXJjaChzdWJ0eXAuc3VidHlwKSA6IG5vTWF0Y2ggfSkpO1xuICAgICAgaWYgKCF0eXBNYXRjaCkgc3VidHlwTWF0Y2hlcyA9IHN1YnR5cE1hdGNoZXMuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkubWF0Y2gpO1xuICAgICAgaWYgKCF0eXBNYXRjaCAmJiBzdWJ0eXBNYXRjaGVzLmxlbmd0aCA9PT0gMCkgY29udGludWU7XG5cbiAgICAgIGNvbnN0IHNjb3JlcyA9IFt0eXBNYXRjaCwgLi4uc3VidHlwTWF0Y2hlcy5tYXAoKGVudHJ5KSA9PiBlbnRyeS5tYXRjaCldLmZpbHRlcihCb29sZWFuKS5tYXAoKG1hdGNoKSA9PiBtYXRjaC5zY29yZSk7XG4gICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICBzY29yZTogTWF0aC5tYXgoLi4uc2NvcmVzKSxcbiAgICAgICAgcm93czogW3sgaXRlbSwgbWF0Y2g6IHR5cE1hdGNoID8/IG5vTWF0Y2ggfSwgLi4uc3VidHlwTWF0Y2hlcy5tYXAoKGVudHJ5KSA9PiAoeyBpdGVtOiBlbnRyeS5pdGVtLCBtYXRjaDogZW50cnkubWF0Y2ggPz8gbm9NYXRjaCB9KSldLFxuICAgICAgfSk7XG4gICAgfVxuICAgIGlmIChzZWFyY2gpIHJlc3VsdHMuc29ydCgoYSwgYikgPT4gYi5zY29yZSAtIGEuc2NvcmUpO1xuICAgIHJldHVybiByZXN1bHRzLmZsYXRNYXAoKGdyb3VwKSA9PiBncm91cC5yb3dzKTtcbiAgfVxuXG4gIHJlbmRlclN1Z2dlc3Rpb24obWF0Y2gsIGVsKSB7XG4gICAgY29uc3QgaXRlbSA9IG1hdGNoLml0ZW07XG4gICAgaWYgKCFpdGVtLnN1YnR5cCkge1xuICAgICAgc3VwZXIucmVuZGVyU3VnZ2VzdGlvbihtYXRjaCwgZWwpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBlbC5hZGRDbGFzcyhcInR5cC1waWNrZXItc3VnZ2VzdGlvblwiLCBcInR5cC1waWNrZXItc3VidHlwXCIpO1xuICAgIC8vIE1hdGNoZWQgYWdhaW5zdCB0aGUgU3VidHlwIG5hbWUgYWxvbmUgKHNlZSBnZXRTdWdnZXN0aW9ucykuXG4gICAgdGhpcy5yZW5kZXJDb2xvcmVkTmFtZShlbCwgaXRlbS5zdWJ0eXAsIGl0ZW0udHlwLCBpdGVtLnN1YnR5cCwgbWF0Y2gubWF0Y2g/Lm1hdGNoZXMgPz8gW10pO1xuICAgIGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLXBpY2tlci1jb3VudFwiLCB0ZXh0OiBTdHJpbmcoaXRlbS5jb3VudCkgfSk7XG4gIH1cblxuICBvbkNob29zZUl0ZW0oaXRlbSkge1xuICAgIHRoaXMucmVzb2x2ZSh7IHR5cDogaXRlbS50eXAsIHN1YnR5cDogaXRlbS5zdWJ0eXAgPz8gbnVsbCB9KTtcbiAgfVxufVxuXG4vLyBJbml0aWFsIG9yZGVyIG9mIGEgcGlja2VyIGxpc3QgZ2l2ZW4gYW4gYWxyZWFkeSB0eXBlZCBxdWVyeSAoZnJvbSB0aGVcbi8vIFRZUC1QaWNrZXIsIHNlZSBwaWNrVHlwRW50cnkpOiBtYXRjaGVzIGZpcnN0IGJ5IHNjb3JlLCB0aGUgcmVzdCBhZnRlciBpblxuLy8gdW5jaGFuZ2VkIG9yZGVyLiBJZiBub3RoaW5nIG1hdGNoZXMgKGEgZGVzY3JpcHRpb24gd2FzIHR5cGVkLCBzYXkpIHRoZVxuLy8gbGlzdCBzdGF5cyBhcyBpdCB3YXMuIFR5cGluZyBpbiB0aGUgcGlja2VyIGl0c2VsZiB1c2VzIE9ic2lkaWFuJ3Mgc2VhcmNoLlxuZnVuY3Rpb24gc29ydEJ5UXVlcnkoaXRlbXMsIHF1ZXJ5LCBpdGVtVGV4dCkge1xuICBjb25zdCBzZWFyY2ggPSBxdWVyeT8udHJpbSgpID8gcHJlcGFyZUZ1enp5U2VhcmNoKHF1ZXJ5LnRyaW0oKSkgOiBudWxsO1xuICBpZiAoIXNlYXJjaCkgcmV0dXJuIGl0ZW1zO1xuICBjb25zdCBzY29yZWQgPSBpdGVtcy5tYXAoKGl0ZW0sIGluZGV4KSA9PiAoeyBpdGVtLCBpbmRleCwgc2NvcmU6IHNlYXJjaChpdGVtVGV4dChpdGVtKSk/LnNjb3JlID8/IG51bGwgfSkpO1xuICBpZiAoc2NvcmVkLmV2ZXJ5KChlbnRyeSkgPT4gZW50cnkuc2NvcmUgPT09IG51bGwpKSByZXR1cm4gaXRlbXM7XG4gIHNjb3JlZC5zb3J0KChhLCBiKSA9PiB7XG4gICAgaWYgKGEuc2NvcmUgPT09IG51bGwgfHwgYi5zY29yZSA9PT0gbnVsbCkgcmV0dXJuIGEuc2NvcmUgPT09IGIuc2NvcmUgPyBhLmluZGV4IC0gYi5pbmRleCA6IGEuc2NvcmUgPT09IG51bGwgPyAxIDogLTE7XG4gICAgcmV0dXJuIGIuc2NvcmUgLSBhLnNjb3JlIHx8IGEuaW5kZXggLSBiLmluZGV4O1xuICB9KTtcbiAgcmV0dXJuIHNjb3JlZC5tYXAoKGVudHJ5KSA9PiBlbnRyeS5pdGVtKTtcbn1cblxuLy8gRm9yIFRZUC5qczogb3BlbnMgdGhlIFN1YnR5cC1QaWNrZXIgaWYgdGhlIFRZUCBoYXMgYXQgbGVhc3Qgb25lIHJlZ2lzdGVyZWRcbi8vIFN1YnR5cCAoaW4gYmxvY2sgb3JkZXIpLiBxdWVyeSBwcmUtc29ydHMgdGhlIGxpc3Q6IHR5cGluZyBcIkxlaHJ2ZXJhbnN0YWx0dW5nXCJcbi8vIHRvIHJlYWNoIE9SR0EgbWVhbnQgdGhhdCBTdWJ0eXAsIHdoaWNoIHRoZW4gc2l0cyBvbiB0b3AgLSBFbnRlciBzdWZmaWNlcy5cbi8vIG9wdGlvbnMgYXMgaW4gZ2V0U3VidHlwczogU3VidHlwcyB0aGF0IGFyZW4ndCBtYW51YWxseSBjcmVhdGFibGUgYXJlIGxlZnRcbi8vIG91dCBieSBkZWZhdWx0LCBsaWtlIHN1Y2ggVFlQIGVudHJpZXMgYmVmb3JlLiBSZXNvbHZlcyB3aXRoXG4vLyAgLSB0aGUgY2hvc2VuIFN1YnR5cCxcbi8vICAtIFwiXCIgZm9yIFwibm8gU3VidHlwXCIgKHRoZSBmaXJzdCByb3cgd2l0aG91dCBhIHF1ZXJ5KSAtIG9yIHJpZ2h0IGF3YXksXG4vLyAgICB3aXRob3V0IGEgcGlja2VyLCBpZiB0aGUgVFlQIGhhcyBubyBzZWxlY3RhYmxlIFN1YnR5cCxcbi8vICAtIG51bGwgb24gRVNDIChUWVAuanMgZ29lcyBiYWNrIHRvIHRoZSBUWVAgY2hvaWNlKS5cbmZ1bmN0aW9uIHBpY2tTdWJ0eXAoYXBwLCBwbHVnaW4sIHR5cCwgcXVlcnkgPSBcIlwiLCBvcHRpb25zID0ge30pIHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgY29uc3QgaXRlbXMgPSBwbHVnaW4uZ2V0U3VidHlwcyh0eXAsIG9wdGlvbnMpLm1hcCgoeyBzdWJ0eXAsIGNvdW50IH0pID0+ICh7IHR5cDogc3VidHlwLCBkZXNjcmlwdGlvbjogXCJcIiwgY291bnQgfSkpO1xuICAgIGlmIChpdGVtcy5sZW5ndGggPT09IDApIHtcbiAgICAgIHJlc29sdmUoXCJcIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIC8vIFwibm8gU3VidHlwXCIgZmlyc3Q6IEVudGVyIHBpY2tzIGl0IHdpdGhvdXQgdHlwaW5nLCBhbmQgaXQgaXMgbW9yZSBjb21tb25cbiAgICAvLyB0aGFuIGFueSBzaW5nbGUgU3VidHlwLlxuICAgIGNvbnN0IG5vbmVDb3VudCA9IHBsdWdpbi50eXBJbmRleC5zdWJ0eXBCdWNrZXQodHlwKS5ub1N1YnR5cDtcbiAgICBpdGVtcy51bnNoaWZ0KHsgdHlwOiBcIm5vIFN1YnR5cFwiLCBkZXNjcmlwdGlvbjogXCJcIiwgY291bnQ6IG5vbmVDb3VudCwgbm9uZTogdHJ1ZSB9KTtcbiAgICBuZXcgU3VidHlwUGlja2VyTW9kYWwoYXBwLCBwbHVnaW4sIHR5cCwgaXRlbXMsIHJlc29sdmUsIHF1ZXJ5KS5vcGVuKCk7XG4gIH0pO1xufVxuXG4vLyBUWVAgdmFsdWVzIHRoYXQgb2NjdXIgaW4gbm90ZXMgYnV0IGFyZW4ndCBpbiBzZXR0aW5ncy50eXBzLCBsaWtlIHRoZVxuLy8gdW5yZWdpc3RlcmVkIHJvd3Mgb2YgdGhlIFRZUC1MaXN0LiBMaXN0cyBhbmQgcGFkZGVkIHZhbHVlcyAoc2VlIGlzQ2xlYW5LZXkpXG4vLyBhcmUgbGVmdCBvdXQ6IHRoZSBjaG9zZW4gdmFsdWUgaXMgd3JpdHRlbiBpbnRvIGEgbmV3IG5vdGUgYW5kIHNob3VsZG4ndCBiZSBhXG4vLyBjbGVhbnVwIGNhc2UgdGhlcmUuXG5mdW5jdGlvbiB1bnJlZ2lzdGVyZWRJdGVtcyhhcHAsIHBsdWdpbikge1xuICBjb25zdCByZWdpc3RlcmVkID0gbmV3IFNldChwbHVnaW4uc2V0dGluZ3MudHlwcyk7XG4gIGNvbnN0IHsgY291bnRzIH0gPSBwbHVnaW4udHlwSW5kZXgudHlwQ291bnRzKCk7XG4gIGNvbnN0IHNvcnRPcmRlciA9IHBsdWdpbi5zZXR0aW5ncy50eXBTb3J0T3JkZXIgPz8gREVGQVVMVF9TT1JUX09SREVSO1xuICByZXR1cm4gWy4uLmNvdW50cy5rZXlzKCldXG4gICAgLmZpbHRlcigodHlwKSA9PiAhcmVnaXN0ZXJlZC5oYXModHlwKSAmJiBwbHVnaW4udHlwSW5kZXguaXNDbGVhbktleSh0eXApKVxuICAgIC5zb3J0KChhLCBiKSA9PiBjb21wYXJlVHlwcyhzb3J0T3JkZXIsIGEsIGIsIGNvdW50cywgcGx1Z2luLnNldHRpbmdzLnR5cENvbG9ycykpXG4gICAgLm1hcCgodHlwKSA9PiAoeyB0eXAsIGRlc2NyaXB0aW9uOiBcIlwiLCBjb3VudDogY291bnRzLmdldCh0eXApID8/IDAsIHVucmVnaXN0ZXJlZDogdHJ1ZSB9KSk7XG59XG5cbi8vIFBpY2tzIGEgc2luZ2xlIFRZUCwgZm9yIFRZUC5qcyBhbmQgZXZlcnl3aGVyZSBpbiB0aGUgcGx1Z2luLiBpbmNsdWRlTWFudWFsT2ZmXG4vLyBhcyBpbiBnZXRUeXBzKCk7IGluY2x1ZGVVbnJlZ2lzdGVyZWQgYWRkcyB2YWx1ZXMgdGhhdCBvY2N1ciBpbiBub3RlcyBidXRcbi8vIGFyZW4ndCByZWdpc3RlcmVkIChtdXRlZCkuIHNob3dTdWJ0eXBzIHB1dHMgdGhlIFN1YnR5cCBuYW1lcyBhZnRlciB0aGUgVFlQXG4vLyBuYW1lLCBmb3IgdGhlIHNlcGFyYXRlIGZsb3cgd2hlcmUgdGhlIFN1YnR5cC1QaWNrZXIgY29tZXMgYWZ0ZXJ3YXJkcy5cbi8vIFJlc29sdmVzIHdpdGggdGhlIFRZUCwgb3IgbnVsbCBvbiBjYW5jZWwgb3IgaWYgdGhlcmUgaXMgbm90aGluZyB0byBzaG93LlxuZnVuY3Rpb24gcGlja1R5cChhcHAsIHBsdWdpbiwgb3B0aW9ucyA9IHt9KSB7XG4gIHJldHVybiBwaWNrVHlwRW50cnkoYXBwLCBwbHVnaW4sIG9wdGlvbnMpLnRoZW4oKGVudHJ5KSA9PiBlbnRyeT8udHlwID8/IG51bGwpO1xufVxuXG4vLyBMaWtlIHBpY2tUeXAsIGJ1dCByZXNvbHZlcyB3aXRoIHsgdHlwLCBxdWVyeSB9LCBxdWVyeSBiZWluZyB3aGF0IHdhcyB0eXBlZC5cbi8vIE9ubHkgZm9yIHBpY2tUeXBBbmRTdWJ0eXAsIHdoaWNoIHBhc3NlcyBpdCBvbiB0byB0aGUgU3VidHlwLVBpY2tlci5cbmZ1bmN0aW9uIHBpY2tUeXBFbnRyeShhcHAsIHBsdWdpbiwgb3B0aW9ucyA9IHt9KSB7XG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgIGNvbnN0IGl0ZW1zID0gdHlwSXRlbXMoYXBwLCBwbHVnaW4sIG9wdGlvbnMpO1xuICAgIGlmICghaXRlbXMpIHtcbiAgICAgIHJlc29sdmUobnVsbCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IG1vZGFsID0gbmV3IFR5cFBpY2tlck1vZGFsKGFwcCwgcGx1Z2luLCBpdGVtcywgKHR5cCkgPT4gcmVzb2x2ZSh0eXAgPT09IG51bGwgPyBudWxsIDogeyB0eXAsIHF1ZXJ5OiBtb2RhbC5xdWVyeSB9KSk7XG4gICAgbW9kYWwub3BlbigpO1xuICB9KTtcbn1cblxuLy8gU2hhcmVkIFRZUCBsaXN0IGZvciBwaWNrVHlwL3BpY2tUeXBBbmRTdWJ0eXA7IG51bGwgcGx1cyBhIG5vdGljZSBpZiB0aGVyZSBpc1xuLy8gbm90aGluZyB0byBzaG93IHdpdGggdGhlc2Ugb3B0aW9ucy5cbmZ1bmN0aW9uIHR5cEl0ZW1zKGFwcCwgcGx1Z2luLCB7IGluY2x1ZGVNYW51YWxPZmYgPSBmYWxzZSwgaW5jbHVkZVVucmVnaXN0ZXJlZCA9IGZhbHNlLCBzaG93U3VidHlwcyA9IGZhbHNlIH0gPSB7fSkge1xuICBjb25zdCBpdGVtcyA9IHBsdWdpbi5nZXRUeXBzKHsgaW5jbHVkZU1hbnVhbE9mZiB9KS5tYXAoKGl0ZW0pID0+ICh7IC4uLml0ZW0sIHVucmVnaXN0ZXJlZDogZmFsc2UgfSkpO1xuICBpZiAoaW5jbHVkZVVucmVnaXN0ZXJlZCkgaXRlbXMucHVzaCguLi51bnJlZ2lzdGVyZWRJdGVtcyhhcHAsIHBsdWdpbikpO1xuICAvLyBPbmx5IHJlZ2lzdGVyZWQgVFlQIGVudHJpZXMgaGF2ZSBTdWJ0eXBzOyB0aGUgb3RoZXJzIHN0YXkgdW5jaGFuZ2VkLlxuICBpZiAoc2hvd1N1YnR5cHMpIHtcbiAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgaXRlbXMpIGl0ZW0uc3VidHlwcyA9IHBsdWdpbi5nZXRTdWJ0eXBzKGl0ZW0udHlwLCB7IGluY2x1ZGVNYW51YWxPZmYgfSkubWFwKCh7IHN1YnR5cCB9KSA9PiBzdWJ0eXApO1xuICB9XG4gIGlmIChpdGVtcy5sZW5ndGggPiAwKSByZXR1cm4gaXRlbXM7XG4gIG5ldyBOb3RpY2UoXCJObyBUWVAgYXZhaWxhYmxlLlwiKTtcbiAgcmV0dXJuIG51bGw7XG59XG5cbi8vIEZvciBUWVAuanM6IFRZUCBhbmQgU3VidHlwIGluIG9uZSBnby4gV2l0aCBzZXBhcmF0ZVN1YnR5cFBpY2tlciBvZmYsIG9uZVxuLy8gcGlja2VyIHdpdGggZWFjaCBTdWJ0eXAgaW5kZW50ZWQgYmVsb3cgaXRzIFRZUDsgd2l0aCBpdCBvbiwgZmlyc3QgdGhlXG4vLyBUWVAtUGlja2VyIChTdWJ0eXAgbmFtZXMgYWZ0ZXIgdGhlIFRZUCBuYW1lKSBhbmQgdGhlbiwgaWYgdGhlcmUgaXMgYVxuLy8gc2VsZWN0YWJsZSBTdWJ0eXAsIHRoZSBTdWJ0eXAtUGlja2VyIHByZS1zb3J0ZWQgYnkgdGhlIHF1ZXJ5IChFU0MgZ29lcyBiYWNrXG4vLyB0byB0aGUgVFlQIGNob2ljZSkuIGluY2x1ZGVNYW51YWxPZmYgYWxzbyBhcHBsaWVzIHRvIHRoZSBTdWJ0eXBzLlxuLy8gUmVzb2x2ZXMgd2l0aCB7IHR5cCwgc3VidHlwIH0gKHN1YnR5cCBudWxsIGZvciBcIm5vIFN1YnR5cFwiKSwgb3IgbnVsbCBvblxuLy8gY2FuY2VsLlxuYXN5bmMgZnVuY3Rpb24gcGlja1R5cEFuZFN1YnR5cChhcHAsIHBsdWdpbiwgb3B0aW9ucyA9IHt9KSB7XG4gIGlmIChwbHVnaW4uc2V0dGluZ3Muc2VwYXJhdGVTdWJ0eXBQaWNrZXIpIHtcbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgY29uc3QgZW50cnkgPSBhd2FpdCBwaWNrVHlwRW50cnkoYXBwLCBwbHVnaW4sIHsgLi4ub3B0aW9ucywgc2hvd1N1YnR5cHM6IHRydWUgfSk7XG4gICAgICBpZiAoIWVudHJ5KSByZXR1cm4gbnVsbDtcbiAgICAgIGNvbnN0IHN1YnR5cCA9IGF3YWl0IHBpY2tTdWJ0eXAoYXBwLCBwbHVnaW4sIGVudHJ5LnR5cCwgZW50cnkucXVlcnksIG9wdGlvbnMpO1xuICAgICAgaWYgKHN1YnR5cCAhPT0gbnVsbCkgcmV0dXJuIHsgdHlwOiBlbnRyeS50eXAsIHN1YnR5cDogc3VidHlwIHx8IG51bGwgfTtcbiAgICB9XG4gIH1cblxuICBjb25zdCBpdGVtcyA9IHR5cEl0ZW1zKGFwcCwgcGx1Z2luLCBvcHRpb25zKTtcbiAgaWYgKCFpdGVtcykgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGdyb3VwcyA9IGl0ZW1zLm1hcCgoaXRlbSkgPT4gKHtcbiAgICBpdGVtLFxuICAgIHN1YnR5cHM6IHBsdWdpbi5nZXRTdWJ0eXBzKGl0ZW0udHlwLCBvcHRpb25zKS5tYXAoKHsgc3VidHlwLCBjb3VudCB9KSA9PiAoeyB0eXA6IGl0ZW0udHlwLCBzdWJ0eXAsIGNvdW50IH0pKSxcbiAgfSkpO1xuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IG5ldyBUeXBTdWJ0eXBQaWNrZXJNb2RhbChhcHAsIHBsdWdpbiwgZ3JvdXBzLCByZXNvbHZlKS5vcGVuKCkpO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcGlja1R5cCwgcGlja1N1YnR5cCwgcGlja1R5cEFuZFN1YnR5cCB9O1xuIiwgImNvbnN0IHsgVEZpbGUsIFZhdWx0LCBkZWJvdW5jZSwgbm9ybWFsaXplUGF0aCB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuXG4vLyBPbmx5IFRlbXBsYXRlciBzY3JpcHRzIHdpdGggdGhpcyBtYXJrZXIgaW4gYSBjb21tZW50IGFyZSBvZmZlcmVkIGluIHRoZVxuLy8gc2hvcnRjdXQgcGlja2VyOyBoZWxwZXIgc2NyaXB0cyBtYWtlIG5vIHNlbnNlIGFzIHNob3J0Y3V0cy4gVGhlIHRleHQgYWZ0ZXJcbi8vIHRoZSBtYXJrZXIgdXAgdG8gdGhlIGxpbmUgZW5kIGlzIHRoZSBkZXNjcmlwdGlvbiAoYSBjbG9zaW5nIFwiKi9cIiBpcyBub3Rcbi8vIHBhcnQgb2YgaXQpLlxuLy9cbi8vIEFuIG9wdGlvbmFsIHBhcmFtZXRlciBsaXN0IGluIHBhcmVudGhlc2VzIHJpZ2h0IGFmdGVyIHRoZSBtYXJrZXIgZGVzY3JpYmVzXG4vLyB0aGUgQ09NUExFVEUgYXJndW1lbnQgbGlzdCBhZnRlciBcInRwXCIsIGluY2x1ZGluZyB3aGVyZSB0aGUgc2NyaXB0IHdhbnRzIHRoZVxuLy8gZmlsZSBvciBjb250ZXh0IChzZWUgUkVTRVJWRURfUEFSQU1TIGluIHNob3J0Y3V0cy5qcyk6XG4vLyAgIC8vIEB0eXAtc2hvcnRjdXQoZm9sZGVyLCB5ZWFyKSAgICAgIC0+IGYodHAsIFwiTGl0ZXJhdHVyXCIsIDIwMjQpXG4vLyAgIC8vIEB0eXAtc2hvcnRjdXQobmV3RmlsZSwgeWVhcikgICAgIC0+IGYodHAsIG5ld0ZpbGUsIDIwMjQpXG4vLyAgIC8vIEB0eXAtc2hvcnRjdXQocHJvcGVydHkpICAgICAgICAgIC0+IGYodHAsIFwiRmFtaWxpZVwiKVxuLy8gICAvLyBAdHlwLXNob3J0Y3V0ICAgICAgICAgICAgICAgICAgICAtPiBmKHRwLCBuZXdGaWxlLCBjdHgpXG4vLyBObyBwYXJlbnRoZXNlcyAocGFyYW1zID09PSBudWxsKSBpcyB0aGUgY2xhc3NpYyBjYWxsIGYodHAsIG5ld0ZpbGUsIGN0eCk7XG4vLyBlbXB0eSBwYXJlbnRoZXNlcyAocGFyYW1zID09PSBbXSkgcGFzcyBvbmx5IHRwLlxuLy9cbi8vIFRoZSBtYXJrZXIgbXVzdCBzdGFydCB0aGUgY29tbWVudC4gQWxsb3dpbmcgdGV4dCBiZWZvcmUgaXQgb25jZSB0dXJuZWRcbi8vIFRZUC5qcyBpbnRvIGEgc2hvcnRjdXQsIGp1c3QgYmVjYXVzZSBpdHMgaGVhZGVyIGNvbW1lbnQgbWVudGlvbnMgdGhlIG1hcmtlci5cbi8vIFwiXFxiXCIgYWZ0ZXIgdGhlIG5hbWUgcmVqZWN0cyBcIkB0eXAtc2hvcnRjdXRYWVpcIiBidXQgYWxsb3dzIHRoZSBcIihcIi5cbmNvbnN0IFNIT1JUQ1VUX01BUktFUiA9IC9eWyBcXHRdKig/OlxcL1xcLyt8XFwvXFwqK3xcXCopWyBcXHRdKkB0eXAtc2hvcnRjdXRcXGIoPzpcXCgoW14pXSopXFwpKT9bIFxcdF0qKC4qPylbIFxcdF0qKD86XFwqXFwvKT9bIFxcdF0qJC9tO1xuXG4vLyBQYXJhbWV0ZXIgbmFtZXMgZnJvbSB0aGUgbWFya2VyLCBpbiBkZWNsYXJlZCBvcmRlci4gRW1wdHkgZW50cmllcyAoXCIoKVwiLCBhXG4vLyBzdHJheSBjb21tYSkgYXJlIGRyb3BwZWQsIGR1cGxpY2F0ZXMga2VwdCBvbmNlIC0gdHdvIGZpZWxkcyB3cml0aW5nIHRoZSBzYW1lXG4vLyBlbnRyeSB3b3VsZCBvbmx5IGNvbmZ1c2UuXG5mdW5jdGlvbiBwYXJzZVBhcmFtcyhyYXcpIHtcbiAgY29uc3QgbmFtZXMgPSAocmF3ID8/IFwiXCIpXG4gICAgLnNwbGl0KFwiLFwiKVxuICAgIC5tYXAoKG5hbWUpID0+IG5hbWUudHJpbSgpKVxuICAgIC5maWx0ZXIoKG5hbWUpID0+IG5hbWUgIT09IFwiXCIpO1xuICByZXR1cm4gWy4uLm5ldyBTZXQobmFtZXMpXTtcbn1cblxuLy8gS2VlcHMgdGhlIGxpc3Qgb2YgbWFya2VkIFRlbXBsYXRlciBzY3JpcHRzIGN1cnJlbnQuIEl0IGlzIHJlYWQgYWhlYWQgb2YgdGltZVxuLy8gYW5kIHVwZGF0ZWQgb24gY2hhbmdlcywgc28gdGhlIHBpY2tlciBvcGVucyB3aXRob3V0IHdhaXRpbmcgYW5kIHdpdGhvdXQgZmlsZVxuLy8gYWNjZXNzLiBSZXR1cm5zIGFuIGFjY2Vzc29yIGZvciB0aGUgbGlzdCAoW3sgbmFtZSwgcGFyYW1zLCBkZXNjcmlwdGlvbiB9XSxcbi8vIHNvcnRlZCBieSBuYW1lKSwgd2l0aCB0d28gYWRkaXRpb25zIGZvciB0aGUgXCJzY3JpcHQgbm90IGZvdW5kXCIgd2FybmluZyBvZlxuLy8gdGhlIHByb3BlcnR5IHJvd3MgKHNlZSByZW5kZXJTaG9ydGN1dENvbnRyb2xzIGluIHR5cC1mcm9udG1hdHRlci1lZGl0b3IuanMpOlxuLy8gICBhY2Nlc3Nvci5pc0xvYWRlZCgpICAgZmFsc2UgdW50aWwgdGhlIGZvbGRlciB3YXMgcmVhZCBvbmNlIC0gYmVmb3JlIHRoYXRcbi8vICAgICAgICAgICAgICAgICAgICAgICAgIGFuIGVtcHR5IGxpc3QgbWVhbnMgXCJub3Qga25vd24geWV0XCIsIG5vdCBcIm1pc3NpbmdcIixcbi8vICAgICAgICAgICAgICAgICAgICAgICAgIGFuZCBubyByb3cgbWF5IHdhcm5cbi8vICAgYWNjZXNzb3Iub25DaGFuZ2UoZm4pIGZuIHJ1bnMgYWZ0ZXIgdGhlIGZpcnN0IHJlYWQgYW5kIHdoZW5ldmVyIHRoZSBsaXN0XG4vLyAgICAgICAgICAgICAgICAgICAgICAgICBjaGFuZ2VkOyByZXR1cm5zIGEgZnVuY3Rpb24gdGhhdCB1bnN1YnNjcmliZXNcbmZ1bmN0aW9uIHJlZ2lzdGVyU2hvcnRjdXRTY3JpcHRzKHBsdWdpbikge1xuICBjb25zdCB7IGFwcCB9ID0gcGx1Z2luO1xuXG4gIGxldCBzY3JpcHRGb2xkZXIgPSBudWxsO1xuICBsZXQgc2NyaXB0cyA9IFtdO1xuICBsZXQgbG9hZGVkID0gZmFsc2U7XG4gIGNvbnN0IGxpc3RlbmVycyA9IG5ldyBTZXQoKTtcblxuICBjb25zdCBjdXJyZW50U2NyaXB0Rm9sZGVyID0gKCkgPT4ge1xuICAgIGNvbnN0IGZvbGRlciA9IGFwcC5wbHVnaW5zLnBsdWdpbnNbXCJ0ZW1wbGF0ZXItb2JzaWRpYW5cIl0/LnNldHRpbmdzPy51c2VyX3NjcmlwdHNfZm9sZGVyO1xuICAgIHJldHVybiBmb2xkZXIgPyBub3JtYWxpemVQYXRoKGZvbGRlcikgOiBudWxsO1xuICB9O1xuXG4gIGNvbnN0IGlzSW5TY3JpcHRGb2xkZXIgPSAocGF0aCkgPT4gISFzY3JpcHRGb2xkZXIgJiYgISFwYXRoICYmIHBhdGguc3RhcnRzV2l0aChzY3JpcHRGb2xkZXIgKyBcIi9cIik7XG5cbiAgLy8gTGlrZSBUZW1wbGF0ZXI6IGV2ZXJ5IC5qcyBpbiB0aGUgc2NyaXB0IGZvbGRlciBpbmNsdWRpbmcgc3ViZm9sZGVycyxcbiAgLy8gc2NyaXB0IG5hbWUgPSBmaWxlIG5hbWUgd2l0aG91dCBleHRlbnNpb24uXG4gIGFzeW5jIGZ1bmN0aW9uIHJlZnJlc2hTY3JpcHRzKCkge1xuICAgIGNvbnN0IGZvbGRlclBhdGggPSBjdXJyZW50U2NyaXB0Rm9sZGVyKCk7XG4gICAgc2NyaXB0Rm9sZGVyID0gZm9sZGVyUGF0aDtcbiAgICBjb25zdCBmb2xkZXIgPSBmb2xkZXJQYXRoID8gYXBwLnZhdWx0LmdldEZvbGRlckJ5UGF0aChmb2xkZXJQYXRoKSA6IG51bGw7XG4gICAgY29uc3QgZmlsZXMgPSBbXTtcbiAgICBpZiAoZm9sZGVyKSB7XG4gICAgICBWYXVsdC5yZWN1cnNlQ2hpbGRyZW4oZm9sZGVyLCAoY2hpbGQpID0+IHtcbiAgICAgICAgaWYgKGNoaWxkIGluc3RhbmNlb2YgVEZpbGUgJiYgY2hpbGQuZXh0ZW5zaW9uID09PSBcImpzXCIpIGZpbGVzLnB1c2goY2hpbGQpO1xuICAgICAgfSk7XG4gICAgfVxuICAgIGNvbnN0IGZvdW5kID0gW107XG4gICAgZm9yIChjb25zdCBmaWxlIG9mIGZpbGVzKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBtYXRjaCA9IChhd2FpdCBhcHAudmF1bHQuY2FjaGVkUmVhZChmaWxlKSkubWF0Y2goU0hPUlRDVVRfTUFSS0VSKTtcbiAgICAgICAgLy8gbWF0Y2hbMV0gaXMgdW5kZWZpbmVkIHdpdGhvdXQgcGFyZW50aGVzZXMgYW5kIFwiXCIgd2l0aCBlbXB0eSBvbmVzO1xuICAgICAgICAvLyB0aGF0IGRpZmZlcmVuY2UgZGVjaWRlcyB0aGUgY2FsbCBmb3JtLlxuICAgICAgICBpZiAobWF0Y2gpIHtcbiAgICAgICAgICBmb3VuZC5wdXNoKHtcbiAgICAgICAgICAgIG5hbWU6IGZpbGUuYmFzZW5hbWUsXG4gICAgICAgICAgICBwYXJhbXM6IG1hdGNoWzFdID09PSB1bmRlZmluZWQgPyBudWxsIDogcGFyc2VQYXJhbXMobWF0Y2hbMV0pLFxuICAgICAgICAgICAgZGVzY3JpcHRpb246IG1hdGNoWzJdID8/IFwiXCIsXG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihgVFlQLVN5c3RlbTogY2FuJ3QgcmVhZCBUZW1wbGF0ZXIgc2NyaXB0ICR7ZmlsZS5wYXRofWAsIGUpO1xuICAgICAgfVxuICAgIH1cbiAgICAvLyBGb2xkZXIgY2hhbmdlZCBpbiBUZW1wbGF0ZXIgbWVhbndoaWxlOiBkcm9wIHRoaXMgcmVzdWx0LCB0aGUgcnVuIGZvciB0aGVcbiAgICAvLyBuZXcgZm9sZGVyIGlzIGFscmVhZHkgc2NoZWR1bGVkLlxuICAgIGlmIChmb2xkZXJQYXRoICE9PSBzY3JpcHRGb2xkZXIpIHJldHVybjtcbiAgICBmb3VuZC5zb3J0KChhLCBiKSA9PiBhLm5hbWUubG9jYWxlQ29tcGFyZShiLm5hbWUpKTtcbiAgICAvLyBFZGl0aW5nIGEgc2NyaXB0IHRyaWdnZXJzIGEgcmVzY2FuIHRvbzsgb25seSBhIHJlYWwgY2hhbmdlIChhIHNjcmlwdFxuICAgIC8vIGFkZGVkLCByZW1vdmVkLCByZW5hbWVkIG9yIGl0cyBtYXJrZXIgY2hhbmdlZCkgaXMgcGFzc2VkIG9uLlxuICAgIGNvbnN0IGNoYW5nZWQgPSAhbG9hZGVkIHx8IEpTT04uc3RyaW5naWZ5KGZvdW5kKSAhPT0gSlNPTi5zdHJpbmdpZnkoc2NyaXB0cyk7XG4gICAgc2NyaXB0cyA9IGZvdW5kO1xuICAgIGxvYWRlZCA9IHRydWU7XG4gICAgaWYgKCFjaGFuZ2VkKSByZXR1cm47XG4gICAgZm9yIChjb25zdCBsaXN0ZW5lciBvZiBsaXN0ZW5lcnMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGxpc3RlbmVyKCk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKFwiVFlQLVN5c3RlbTogc2hvcnRjdXQgc2NyaXB0IGxpc3RlbmVyIGZhaWxlZFwiLCBlcnJvcik7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgY29uc3Qgc2NoZWR1bGVSZWZyZXNoID0gZGVib3VuY2UocmVmcmVzaFNjcmlwdHMsIDMwMCwgdHJ1ZSk7XG4gIGNvbnN0IG9uRmlsZUNoYW5nZSA9IChmaWxlLCBvbGRQYXRoKSA9PiB7XG4gICAgaWYgKGlzSW5TY3JpcHRGb2xkZXIoZmlsZT8ucGF0aCkgfHwgaXNJblNjcmlwdEZvbGRlcihvbGRQYXRoKSkgc2NoZWR1bGVSZWZyZXNoKCk7XG4gIH07XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KGFwcC52YXVsdC5vbihcImNyZWF0ZVwiLCBvbkZpbGVDaGFuZ2UpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoYXBwLnZhdWx0Lm9uKFwibW9kaWZ5XCIsIG9uRmlsZUNoYW5nZSkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChhcHAudmF1bHQub24oXCJkZWxldGVcIiwgb25GaWxlQ2hhbmdlKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KGFwcC52YXVsdC5vbihcInJlbmFtZVwiLCBvbkZpbGVDaGFuZ2UpKTtcbiAgYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KHJlZnJlc2hTY3JpcHRzKTtcblxuICBjb25zdCBhY2Nlc3NvciA9ICgpID0+IHtcbiAgICAvLyBUZW1wbGF0ZXIgZm9sZGVyIGNoYW5nZWQ6IHJlbG9hZCBmb3IgdGhlIG5leHQgY2FsbCwgYW5zd2VyIHdpdGggdGhlXG4gICAgLy8gY3VycmVudCBsaXN0IGZvciBub3cuXG4gICAgaWYgKGN1cnJlbnRTY3JpcHRGb2xkZXIoKSAhPT0gc2NyaXB0Rm9sZGVyKSBzY2hlZHVsZVJlZnJlc2goKTtcbiAgICByZXR1cm4gc2NyaXB0cztcbiAgfTtcbiAgYWNjZXNzb3IuaXNMb2FkZWQgPSAoKSA9PiBsb2FkZWQ7XG4gIGFjY2Vzc29yLm9uQ2hhbmdlID0gKGxpc3RlbmVyKSA9PiB7XG4gICAgbGlzdGVuZXJzLmFkZChsaXN0ZW5lcik7XG4gICAgcmV0dXJuICgpID0+IGxpc3RlbmVycy5kZWxldGUobGlzdGVuZXIpO1xuICB9O1xuICByZXR1cm4gYWNjZXNzb3I7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlclNob3J0Y3V0U2NyaXB0cywgU0hPUlRDVVRfTUFSS0VSLCBwYXJzZVBhcmFtcyB9O1xuIiwgImNvbnN0IHsgUGx1Z2luIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5jb25zdCB7IERFRkFVTFRfU0VUVElOR1MsIFR5cFN5c3RlbVNldHRpbmdUYWIgfSA9IHJlcXVpcmUoXCIuL3NldHRpbmdzXCIpO1xuY29uc3QgeyByZWdpc3RlckNvbW1hbmRzIH0gPSByZXF1aXJlKFwiLi9jb21tYW5kc1wiKTtcbmNvbnN0IHsgcmVnaXN0ZXJUeXBQYW5lLCBzb3J0VHlwc0J5TW9kZSwgREVGQVVMVF9TT1JUX09SREVSIH0gPSByZXF1aXJlKFwiLi90eXAtcGFuZVwiKTtcbmNvbnN0IHsgVHlwSW5kZXgsIHNldENhbm9uaWNhbFByb3BlcnR5LCBkZWxldGVQcm9wZXJ0eSwgVFlQX1BST1BFUlRZLCBTVUJUWVBfUFJPUEVSVFkgfSA9IHJlcXVpcmUoXCIuL3R5cC1pbmRleFwiKTtcbmNvbnN0IHsgZ2V0U3VidHlwLCBnZXRTdWJ0eXBOYW1lcywgaXNTdWJ0eXBNYW51YWwgfSA9IHJlcXVpcmUoXCIuL3N1YnR5cHNcIik7XG5jb25zdCB7IHJlZ2lzdGVyRmlsZUV4cGxvcmVyQ29sb3JzIH0gPSByZXF1aXJlKFwiLi9maWxlLWV4cGxvcmVyLWNvbG9yc1wiKTtcbmNvbnN0IHsgcmVnaXN0ZXJHcmFwaENvbG9ycyB9ID0gcmVxdWlyZShcIi4vZ3JhcGgtY29sb3JzXCIpO1xuY29uc3QgeyByZWdpc3RlclNlYXJjaENvbG9ycyB9ID0gcmVxdWlyZShcIi4vc2VhcmNoLWNvbG9yc1wiKTtcbmNvbnN0IHsgcmVnaXN0ZXJSZWNlbnRGaWxlc0NvbG9ycyB9ID0gcmVxdWlyZShcIi4vcmVjZW50LWZpbGVzLWNvbG9yc1wiKTtcbmNvbnN0IHsgcmVnaXN0ZXJCYWNrbGlua0NvbG9ycyB9ID0gcmVxdWlyZShcIi4vYmFja2xpbmstY29sb3JzXCIpO1xuY29uc3QgeyByZWdpc3RlckJvb2ttYXJrc0NvbG9ycyB9ID0gcmVxdWlyZShcIi4vYm9va21hcmstY29sb3JzXCIpO1xuY29uc3QgeyByZWdpc3RlckFjdGl2ZVRpdGxlQ29sb3JzIH0gPSByZXF1aXJlKFwiLi9hY3RpdmUtdGl0bGUtY29sb3JzXCIpO1xuY29uc3QgeyByZWdpc3RlckxpbmtDb2xvcnMgfSA9IHJlcXVpcmUoXCIuL2xpbmstY29sb3JzXCIpO1xuY29uc3QgeyByZWdpc3RlckZyb250bWF0dGVyRGVmYXVsdEhpZ2hsaWdodCB9ID0gcmVxdWlyZShcIi4vZnJvbnRtYXR0ZXItZGVmYXVsdC1oaWdobGlnaHRcIik7XG5jb25zdCB7IHJlZ2lzdGVyUHJvcGVydHlSZW5hbWVTeW5jIH0gPSByZXF1aXJlKFwiLi9wcm9wZXJ0eS1yZW5hbWUtc3luY1wiKTtcbmNvbnN0IHsgcmVtb3ZlUHJvcGVydHlNZW51UGF0Y2ggfSA9IHJlcXVpcmUoXCIuL3R5cC1mcm9udG1hdHRlci1lZGl0b3JcIik7XG5jb25zdCB7IG5vcm1hbGl6ZUdsb2JhbE9yZGVyLCBzb3J0RnJvbnRtYXR0ZXJGb3IsIHBsYWNlUHJvcGVydHlGb3IgfSA9IHJlcXVpcmUoXCIuL2Zyb250bWF0dGVyLXNvcnRcIik7XG5jb25zdCB7IHJlc29sdmVTaG9ydGN1dHMsIHNjcmlwdE5hbWVPZiwgcmVzb2x2ZUNhbGxBcmdzIH0gPSByZXF1aXJlKFwiLi9zaG9ydGN1dHNcIik7XG5jb25zdCB7XG4gIHBpY2tUeXA6IHBpY2tUeXBNb2RhbCxcbiAgcGlja1N1YnR5cDogcGlja1N1YnR5cE1vZGFsLFxuICBwaWNrVHlwQW5kU3VidHlwOiBwaWNrVHlwQW5kU3VidHlwTW9kYWwsXG59ID0gcmVxdWlyZShcIi4vdHlwLXBpY2tlclwiKTtcbmNvbnN0IHsgcmVnaXN0ZXJTaG9ydGN1dFNjcmlwdHMgfSA9IHJlcXVpcmUoXCIuL3Nob3J0Y3V0LXNjcmlwdHNcIik7XG5jb25zdCB7IGNsZWFySW5saW5lQ29sb3JzLCBhbGxEb2N1bWVudHMgfSA9IHJlcXVpcmUoXCIuL3R5cC1jb2xvcnNcIik7XG5cbm1vZHVsZS5leHBvcnRzID0gY2xhc3MgVHlwU3lzdGVtUGx1Z2luIGV4dGVuZHMgUGx1Z2luIHtcbiAgYXN5bmMgb25sb2FkKCkge1xuICAgIC8vIFJlYWQgb25jZSBoZXJlOiBubyBkYXRhLmpzb24gKGxvYWREYXRhKCkgcmVzb2x2ZXMgbnVsbCkgbWVhbnMgdGhlIHBsdWdpblxuICAgIC8vIGlzIGxvYWRlZCBmb3IgdGhlIHZlcnkgZmlyc3QgdGltZSBpbiB0aGlzIHZhdWx0LCBhbmQgdGhlIFRZUC1QYW5lIG9wZW5zXG4gICAgLy8gb24gaXRzIG93biBvbmNlIChzZWUgcmVnaXN0ZXJUeXBQYW5lKS5cbiAgICBjb25zdCBkYXRhID0gYXdhaXQgdGhpcy5sb2FkRGF0YSgpO1xuICAgIHRoaXMuaXNGaXJzdFJ1biA9IGRhdGEgPT0gbnVsbDtcbiAgICBhd2FpdCB0aGlzLmxvYWRTZXR0aW5ncyhkYXRhKTtcblxuICAgIC8vIERpc2FibGluZyB0aGUgcGx1Z2luIHRha2VzIGl0cyBpbmxpbmUgY29sb3JzIG91dCBvZiB0aGUgZXhwbG9yZXIsXG4gICAgLy8gc2VhcmNoLCBSZWNlbnQgRmlsZXMsIGJhY2tsaW5rcywgYm9va21hcmtzLCBub3RlIHRpdGxlcyBhbmQgXCJBbGxcbiAgICAvLyBwcm9wZXJ0aWVzXCIgKHNlZSBzZXRJbmxpbmVDb2xvciBpbiB0eXAtY29sb3JzLmpzKTsgdGhvc2Ugdmlld3Mgd291bGRcbiAgICAvLyBrZWVwIHRoZW0gdW50aWwgdGhleSBoYXBwZW4gdG8gcmUtcmVuZGVyLiBSZWdpc3RlcmVkIGZpcnN0IHNvIGl0IHJ1bnNcbiAgICAvLyBsYXN0IG9uIHVubG9hZCwgYWZ0ZXIgdGhlIG1vZHVsZXMgaGF2ZSBzdG9wcGVkIG9ic2VydmluZyBhbmQgbGlzdGVuaW5nLlxuICAgIHRoaXMucmVnaXN0ZXIoKCkgPT4ge1xuICAgICAgZm9yIChjb25zdCBkb2Mgb2YgYWxsRG9jdW1lbnRzKHRoaXMuYXBwKSkgY2xlYXJJbmxpbmVDb2xvcnMoZG9jKTtcbiAgICB9KTtcblxuICAgIC8vIEJlZm9yZSBhbGwgb3RoZXIgbW9kdWxlczogdGhleSBsaXN0ZW4gdG8gaXRzIFwiY2hhbmdlXCIgZXZlbnQgYW5kIHJlYWRcbiAgICAvLyBUWVAvU1VCVFlQIG9ubHkgdGhyb3VnaCBpdCAoc2VlIHR5cC1pbmRleC5qcykuXG4gICAgdGhpcy50eXBJbmRleCA9IG5ldyBUeXBJbmRleCh0aGlzKTtcbiAgICB0aGlzLnR5cEluZGV4LnJlZ2lzdGVyKCk7XG5cbiAgICByZWdpc3RlckNvbW1hbmRzKHRoaXMpO1xuICAgIHRoaXMuYWRkU2V0dGluZ1RhYihuZXcgVHlwU3lzdGVtU2V0dGluZ1RhYih0aGlzLmFwcCwgdGhpcykpO1xuICAgIC8vIENhcnJpZXMgcmVuYW1lcyBmcm9tIFwiQWxsIHByb3BlcnRpZXNcIi9CYXNlcyBpbnRvIHRoZSBUWVAtRnJvbnRtYXR0ZXIuXG4gICAgcmVnaXN0ZXJQcm9wZXJ0eVJlbmFtZVN5bmModGhpcyk7XG4gICAgLy8gVGhlIFRZUC1QYW5lIHBhdGNoZXMgdGhlIHByb3BlcnR5IG1lbnUgbGF6aWx5IChlbnN1cmVQcm9wZXJ0eU1lbnVQYXRjaCkuXG4gICAgdGhpcy5yZWdpc3RlcihyZW1vdmVQcm9wZXJ0eU1lbnVQYXRjaCk7XG4gICAgLy8gQWNjZXNzb3IgZm9yIHRoZSBUZW1wbGF0ZXIgc2NyaXB0cyBtYXJrZWQgXCJAdHlwLXNob3J0Y3V0XCIsIHVzZWQgYnkgdGhlXG4gICAgLy8gc2hvcnRjdXQgcGlja2VyIG9mIHRoZSBwcm9wZXJ0eSByb3dzLlxuICAgIHRoaXMuZ2V0U2hvcnRjdXRTY3JpcHRzID0gcmVnaXN0ZXJTaG9ydGN1dFNjcmlwdHModGhpcyk7XG5cbiAgICAvLyBLZXB0IHNlcGFyYXRlIGZyb20gcmVmcmVzaEZuczogYWZ0ZXIgbW91bnRpbmcgaXRzIGVkaXRvcnMgdGhlIFRZUC1QYW5lXG4gICAgLy8gbmVlZHMgb25seSB0aGlzIHJlZnJlc2ggKGJvbGQgcHJvcGVydHkgbmFtZXMpLiBUaGUgd2hvbGVcbiAgICAvLyByZWZyZXNoVHlwQ29sb3JzKCkgYnVuZGxlIHdvdWxkIGFsc28gdHJpZ2dlciB0aGUgdmlldydzIG93biByZS1yZW5kZXIgYW5kXG4gICAgLy8gcmVjdXJzZSBpbnRvIGEgc3RhY2sgb3ZlcmZsb3cgb24gZXZlcnkgVFlQIG9wZW5lZC5cbiAgICB0aGlzLnJlZnJlc2hGcm9udG1hdHRlckhpZ2hsaWdodCA9IHJlZ2lzdGVyRnJvbnRtYXR0ZXJEZWZhdWx0SGlnaGxpZ2h0KHRoaXMpO1xuXG4gICAgLy8gVHdvIHZhcmlhbnRzLCBsaWtlIHJlZnJlc2hGcm9udG1hdHRlckhpZ2hsaWdodCBhYm92ZTpcbiAgICAvLyAgLSByZWZyZXNoVHlwQ29sb3JzKCkgcmVmcmVzaGVzIGV2ZXJ5IHZpZXcsIHRoZSBUWVAtUGFuZSBpbmNsdWRlZFxuICAgIC8vICAgIChyZS1yZW5kZXJlZCBmcm9tIHRoZSBzZXR0aW5ncykgLSBmb3IgY2hhbmdlcyBtYWRlIGVsc2V3aGVyZSAoc2V0dGluZ3NcbiAgICAvLyAgICB0YWIsIHByb3BlcnR5IHJlbmFtZSBzeW5jLCBTeW5jLCBVbmRvKS5cbiAgICAvLyAgLSByZWZyZXNoVHlwQ29sb3JzRXhjZXB0KHZpZXcpIGxlYXZlcyB0aGF0IG9uZSBUWVAtUGFuZSBvdXQgLSBmb3IgaXRzXG4gICAgLy8gICAgb3duIGFjdGlvbnMuIEEgZnVsbCByZS1yZW5kZXIgdGhlcmUgd291bGQgdGhyb3cgYXdheSBmb2N1cywgYW4gb3BlblxuICAgIC8vICAgIGlubGluZSBpbnB1dCBvciB0aGUgZWRpdG9yIGJlaW5nIHR5cGVkIGluLCBzbyB0aGUgcGFuZSB1cGRhdGVzIGl0c2VsZlxuICAgIC8vICAgIGFuZCBjYWxscyByZW5kZXIoKSBvbmx5IHdoZXJlIGl0IHJlYWxseSBoYXMgdG8gcmVidWlsZC4gT3RoZXJcbiAgICAvLyAgICBUWVAtUGFuZSBsZWF2ZXMgKHJhcmUgLSBzZWUgYWN0aXZhdGVUeXBQYW5lKSBhcmUgc3RpbGwgcmUtcmVuZGVyZWQuXG4gICAgY29uc3QgcmVmcmVzaFR5cFBhbmUgPSByZWdpc3RlclR5cFBhbmUodGhpcyk7XG4gICAgY29uc3QgcmVmcmVzaEZucyA9IFtcbiAgICAgIHJlZ2lzdGVyRmlsZUV4cGxvcmVyQ29sb3JzKHRoaXMpLFxuICAgICAgcmVnaXN0ZXJHcmFwaENvbG9ycyh0aGlzKSxcbiAgICAgIHJlZ2lzdGVyU2VhcmNoQ29sb3JzKHRoaXMpLFxuICAgICAgcmVnaXN0ZXJSZWNlbnRGaWxlc0NvbG9ycyh0aGlzKSxcbiAgICAgIHJlZ2lzdGVyQmFja2xpbmtDb2xvcnModGhpcyksXG4gICAgICByZWdpc3RlckJvb2ttYXJrc0NvbG9ycyh0aGlzKSxcbiAgICAgIHJlZ2lzdGVyQWN0aXZlVGl0bGVDb2xvcnModGhpcyksXG4gICAgICByZWdpc3RlckxpbmtDb2xvcnModGhpcyksXG4gICAgICB0aGlzLnJlZnJlc2hGcm9udG1hdHRlckhpZ2hsaWdodCxcbiAgICBdO1xuICAgIHRoaXMucmVmcmVzaFR5cENvbG9yc0V4Y2VwdCA9IChleGNlcHRWaWV3KSA9PiB7XG4gICAgICByZWZyZXNoVHlwUGFuZShleGNlcHRWaWV3KTtcbiAgICAgIHJlZnJlc2hGbnMuZm9yRWFjaCgoZm4pID0+IGZuKCkpO1xuICAgIH07XG4gICAgdGhpcy5yZWZyZXNoVHlwQ29sb3JzID0gKCkgPT4gdGhpcy5yZWZyZXNoVHlwQ29sb3JzRXhjZXB0KG51bGwpO1xuXG4gICAgLy8gU3R5bGUgU2V0dGluZ3MgcmVhZHMgc3R5bGVzaGVldHMgd2hlbiBpdCBsb2FkcyBhbmQgYWZ0ZXJ3YXJkcyBvbmx5IG9uXG4gICAgLy8gXCJjc3MtY2hhbmdlXCIsIHdoaWNoIGZpcmVzIGZvciB0aGVtZXMgYW5kIHNuaXBwZXRzIGJ1dCBub3QgZm9yIGEgcGx1Z2luJ3NcbiAgICAvLyBzdHlsZXMuY3NzLiBBIHBsdWdpbiBsb2FkZWQgbGF0ZXIgKG9yIGhvdC1yZWxvYWRlZCkgd291bGQgYmUgbWlzc2luZ1xuICAgIC8vIHRoZXJlOyBcInBhcnNlLXN0eWxlLXNldHRpbmdzXCIgaXMgdGhlIGludGVuZGVkIGhvb2suIFdpdGhvdXQgU3R5bGVcbiAgICAvLyBTZXR0aW5ncyBub2JvZHkgbGlzdGVucyBhbmQgbm90aGluZyBoYXBwZW5zLlxuICAgIC8vXG4gICAgLy8gTmV4dCB0aWNrLCBiZWNhdXNlIE9ic2lkaWFuIGFkZHMgYSBwbHVnaW4ncyBzdHlsZXMuY3NzIG9ubHkgQUZURVJcbiAgICAvLyBvbmxvYWQoKS4gb25MYXlvdXRSZWFkeSBkb2Vzbid0IGhlbHA6IG9uIGhvdCByZWxvYWQgdGhlIGxheW91dCBpcyBsb25nXG4gICAgLy8gcmVhZHkgYW5kIHRoZSBjYWxsYmFjayB3b3VsZCBydW4gYXQgb25jZSwganVzdCBhcyBlYXJseS5cbiAgICBjb25zdCBwYXJzZVN0eWxlU2V0dGluZ3MgPSB3aW5kb3cuc2V0VGltZW91dCgoKSA9PiB0aGlzLmFwcC53b3Jrc3BhY2UudHJpZ2dlcihcInBhcnNlLXN0eWxlLXNldHRpbmdzXCIpLCAwKTtcbiAgICB0aGlzLnJlZ2lzdGVyKCgpID0+IHdpbmRvdy5jbGVhclRpbWVvdXQocGFyc2VTdHlsZVNldHRpbmdzKSk7XG4gIH1cblxuICBvbnVubG9hZCgpIHt9XG5cbiAgLy8gRm9yIF9vYnNpZGlhbi90ZW1wbGF0ZXItc2NyaXB0cy9UWVAuanM6IHRoZSBUWVAtRnJvbnRtYXR0ZXIgb2YgYSBUWVAsIHNvXG4gIC8vIFRlbXBsYXRlciBjYW4gYXBwbHkgaXQgdG8gYSBuZXcgbm90ZSBpbnN0ZWFkIG9mIGtlZXBpbmcgYSBzZWNvbmQgY29weS4gQVxuICAvLyBjb3B5LCBzbyBjYWxsZXJzIG1heSBjaGFuZ2UgaXQgZnJlZWx5LlxuICAvL1xuICAvLyBQcm9wZXJ0aWVzIHdpdGggYSBmaXhlZCBzaG9ydGN1dCAodG9kYXkvbm93L2NyZWF0ZWQsIHNlZSBzaG9ydGN1dHMuanMpXG4gIC8vIGNhcnJ5IGl0cyB2YWx1ZSwgY29tcHV0ZWQgZnJlc2ggb24gZWFjaCBjYWxsLiBQcm9wZXJ0aWVzIHdpdGggYSBzY3JpcHRcbiAgLy8gc2hvcnRjdXQgY2FycnkgbnVsbDogb25seSBUZW1wbGF0ZXIgY2FuIHJlc29sdmUgdGhlbSwgVFlQLmpzIGdldHMgdGhlbSB2aWFcbiAgLy8gZ2V0VHlwU2hvcnRjdXRzKCkgYW5kIGZpbGxzIHRoZW0gaW4uIEtleSBhbmQgcG9zaXRpb24gc3RheSBlaXRoZXIgd2F5LlxuICAvL1xuICAvLyBpbmNsdWRlRmxvYXRpbmcgKGRlZmF1bHQgZmFsc2UpIGtlZXBzIGZsb2F0aW5nIGtleXMgaW4gdGhlIHJlc3VsdDsgdGhleVxuICAvLyBhcmUgbm90IGNyZWF0ZWQgZm9yIGV2ZXJ5IG5ldyBub3RlLCBvbmx5IHdoZW4gYSBzY3JpcHQgYXNrcyBmb3IgdGhlbS5cbiAgLy9cbiAgLy8gZmlsZSAob3B0aW9uYWwpIGdvZXMgdG8gcmVzb2x2ZVNob3J0Y3V0cygpIGZvciBcImNyZWF0ZWRcIiwgd2hpY2ggcmV0dXJuc1xuICAvLyB0aGUgZmlsZSdzIGNyZWF0aW9uIGRhdGUgaW5zdGVhZCBvZiB0aGUgY2FsbCB0aW1lLlxuICAvL1xuICAvLyBzdWJ0eXAgKG9wdGlvbmFsKSBhcHBlbmRzIHRoYXQgU3VidHlwJ3MgYmxvY2suIEEga2V5IGluIEJPVEggYmxvY2tzIGtlZXBzXG4gIC8vIHRoZSBUWVAtRnJvbnRtYXR0ZXIgcG9zaXRpb24sIGJ1dCB2YWx1ZSwgZmxvYXRpbmcgZmxhZyBhbmQgc2hvcnRjdXQgY29tZVxuICAvLyBmcm9tIHRoZSBTdWJ0eXAuIEZyb250bWF0dGVyIHNvcnRpbmcgbXVzdCB1c2UgdGhlIHNhbWUgcnVsZSAoc2VlXG4gIC8vIG9yZGVyZWREZWZhdWx0S2V5cyBpbiBmcm9udG1hdHRlci1zb3J0LmpzKSwgb3IgaXQgd291bGQgcmUtc29ydCBhIG5ldyBub3RlXG4gIC8vIHJpZ2h0IGF3YXkuXG4gIGdldFR5cERlZmF1bHRzKHR5cCwgeyBpbmNsdWRlRmxvYXRpbmcgPSBmYWxzZSwgZmlsZSwgc3VidHlwID0gbnVsbCB9ID0ge30pIHtcbiAgICBjb25zdCB7IGRlZmF1bHRzLCBzaG9ydGN1dHMgfSA9IHRoaXMuY29sbGVjdEJsb2Nrcyh0eXAsIHN1YnR5cCwgaW5jbHVkZUZsb2F0aW5nKTtcbiAgICByZXR1cm4gcmVzb2x2ZVNob3J0Y3V0cyhkZWZhdWx0cywgc2hvcnRjdXRzLCB7IGZpbGUsIGFwcDogdGhpcy5hcHAgfSk7XG4gIH1cblxuICAvLyBTaGFyZWQgYmFzZSBvZiBnZXRUeXBEZWZhdWx0cygpIGFuZCBnZXRUeXBTaG9ydGN1dHMoKTogdGhlIFRZUC1Gcm9udG1hdHRlclxuICAvLyBwbHVzIHRoZSBTdWJ0eXAncyBibG9jay4gQSBrZXkgaW4gQk9USCBrZWVwcyB0aGUgVFlQLUZyb250bWF0dGVyIHBvc2l0aW9uO1xuICAvLyB2YWx1ZSwgZmxvYXRpbmcgZmxhZyBBTkQgc2hvcnRjdXQgY29tZSBmcm9tIHRoZSBTdWJ0eXAgLSBcIm5vIHNob3J0Y3V0XCJcbiAgLy8gY291bnRzIGFzIHRoZSBTdWJ0eXAncyBjaG9pY2UgdG9vIGFuZCBjYW5jZWxzIHRoZSBUWVAncy5cbiAgY29sbGVjdEJsb2Nrcyh0eXAsIHN1YnR5cCwgaW5jbHVkZUZsb2F0aW5nKSB7XG4gICAgY29uc3QgZGVmYXVsdHMgPSB7fTtcbiAgICBjb25zdCBzaG9ydGN1dHMgPSB7fTtcbiAgICBjb25zdCBpc0Zsb2F0aW5nID0gbmV3IE1hcCgpO1xuICAgIGNvbnN0IGFkZEJsb2NrID0gKGZyb250bWF0dGVyLCBmbG9hdGluZ0tleXMsIGJsb2NrU2hvcnRjdXRzKSA9PiB7XG4gICAgICBjb25zdCBhY3R1YWxLZXlzID0gbmV3IE1hcChPYmplY3Qua2V5cyhkZWZhdWx0cykubWFwKChrZXkpID0+IFtrZXkudG9Mb3dlckNhc2UoKSwga2V5XSkpO1xuICAgICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoZnJvbnRtYXR0ZXIgPz8ge30pKSB7XG4gICAgICAgIGlmIChrZXkgPT09IFwiXCIpIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCB0YXJnZXQgPSBhY3R1YWxLZXlzLmdldChrZXkudG9Mb3dlckNhc2UoKSkgPz8ga2V5O1xuICAgICAgICBkZWZhdWx0c1t0YXJnZXRdID0gdmFsdWU7XG4gICAgICAgIGlzRmxvYXRpbmcuc2V0KHRhcmdldCwgKGZsb2F0aW5nS2V5cyA/PyBbXSkuaW5jbHVkZXMoa2V5KSk7XG4gICAgICAgIGNvbnN0IHJlY29yZCA9IChibG9ja1Nob3J0Y3V0cyA/PyB7fSlba2V5XTtcbiAgICAgICAgaWYgKHJlY29yZCkgc2hvcnRjdXRzW3RhcmdldF0gPSByZWNvcmQ7XG4gICAgICAgIGVsc2UgZGVsZXRlIHNob3J0Y3V0c1t0YXJnZXRdO1xuICAgICAgfVxuICAgIH07XG4gICAgY29uc3Qgc3VidHlwRGF0YSA9IHN1YnR5cCA/IGdldFN1YnR5cCh0aGlzLnNldHRpbmdzLCB0eXAsIHN1YnR5cCkgOiBudWxsO1xuICAgIGFkZEJsb2NrKFxuICAgICAgdGhpcy5zZXR0aW5ncy50eXBEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwXSxcbiAgICAgIHRoaXMuc2V0dGluZ3MudHlwRmxvYXRpbmdLZXlzW3R5cF0sXG4gICAgICB0aGlzLnNldHRpbmdzLnR5cFNob3J0Y3V0c1t0eXBdXG4gICAgKTtcbiAgICBpZiAoc3VidHlwRGF0YSkgYWRkQmxvY2soc3VidHlwRGF0YS5mcm9udG1hdHRlciwgc3VidHlwRGF0YS5mbG9hdGluZ0tleXMsIHN1YnR5cERhdGEuc2hvcnRjdXRzKTtcblxuICAgIGlmICghaW5jbHVkZUZsb2F0aW5nKSB7XG4gICAgICBmb3IgKGNvbnN0IFtrZXksIGZsb2F0aW5nXSBvZiBpc0Zsb2F0aW5nKSB7XG4gICAgICAgIGlmICghZmxvYXRpbmcpIGNvbnRpbnVlO1xuICAgICAgICBkZWxldGUgZGVmYXVsdHNba2V5XTtcbiAgICAgICAgZGVsZXRlIHNob3J0Y3V0c1trZXldO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4geyBkZWZhdWx0cywgc2hvcnRjdXRzIH07XG4gIH1cblxuICAvLyBGb3IgVFlQLmpzOiB0aGUgcHJvcGVydGllcyBvZiB0aGlzIFRZUCB3aG9zZSB2YWx1ZSBjb21lcyBmcm9tIGEgVGVtcGxhdGVyXG4gIC8vIHNjcmlwdCwgYXMgeyBbcHJvcGVydHldOiB7IG5hbWUsIHBhcmFtcywgYXJncywgZmFsbGJhY2sgfSB9IGluXG4gIC8vIFRZUC1Gcm9udG1hdHRlciBvcmRlciAodGhlIHNjcmlwdHMgcnVuIGluIHR1cm4gYW5kIHNlZSBlYXJsaWVyIHJlc3VsdHMpLlxuICAvL1xuICAvLyAgIG5hbWUgICAgICBzY3JpcHQgbmFtZSB3aXRob3V0IFwidHAuXCIsIGkuZS4gdHAudXNlci48bmFtZT5cbiAgLy8gICBwYXJhbXMgICAgdGhlIHBhcmFtZXRlciBsaXN0IGRlY2xhcmVkIGluIHRoZSBAdHlwLXNob3J0Y3V0IG1hcmtlciwgb3JcbiAgLy8gICAgICAgICAgICAgbnVsbCB3aXRob3V0IHBhcmVudGhlc2VzLiBUYWtlbiBmcm9tIHRoZSBjdXJyZW50IHNjYW4sIHNvIGFcbiAgLy8gICAgICAgICAgICAgY2hhbmdlZCBkZWNsYXJhdGlvbiBhcHBsaWVzIGF0IG9uY2UuIFRZUC5qcyB0dXJucyBpdCBpbnRvIHRoZVxuICAvLyAgICAgICAgICAgICBjYWxsJ3MgYXJndW1lbnRzIHdpdGggcmVzb2x2ZVNob3J0Y3V0QXJncygpXG4gIC8vICAgYXJncyAgICAgIHRoZSB0eXBlZCBhcmd1bWVudHMsIG5hbWVkIGFmdGVyIHRoZSBub24tcmVzZXJ2ZWQgcGFyYW1ldGVycztcbiAgLy8gICAgICAgICAgICAgYW4gZW1wdHkgZmllbGQgaXMgbWlzc2luZyBzbyBcImFyZ3MueCA/PyBmYWxsYmFja1wiIHdvcmtzXG4gIC8vICAgZmFsbGJhY2sgIHRoZSBmaXhlZCB2YWx1ZSBzdG9yZWQgZm9yIHRoZSBwcm9wZXJ0eS4gT25seSBhIEZBTExCQUNLOlxuICAvLyAgICAgICAgICAgICBUWVAuanMgd3JpdGVzIGl0IGlmIHRoZSBzY3JpcHQgaXMgbWlzc2luZyBvciB0aHJvd3MuIEEgc2NyaXB0XG4gIC8vICAgICAgICAgICAgIHRoYXQgZGVsaWJlcmF0ZWx5IHJldHVybnMgbnVsbC9cIlwiIChFU0MgaW4gYSBwaWNrZXIpIGhhcyBub3RcbiAgLy8gICAgICAgICAgICAgZmFpbGVkIC0gdGhlIHByb3BlcnR5IHN0YXlzIGVtcHR5IHRoZW4uXG4gIC8vXG4gIC8vIEZpeGVkIHNob3J0Y3V0cyAodG9kYXkvbm93L2NyZWF0ZWQpIGRvbid0IGFwcGVhciBoZXJlOyBnZXRUeXBEZWZhdWx0cygpXG4gIC8vIGFscmVhZHkgcmVzb2x2ZXMgdGhlbSBhbmQgcmV0dXJucyB0aGUgc2NyaXB0IGtleXMgYXMgbnVsbC5cbiAgLy9cbiAgLy8gT3B0aW9ucyBhcyBpbiBnZXRUeXBEZWZhdWx0cygpOyBpbmNsdWRlRmxvYXRpbmcgZGVmYXVsdHMgdG8gZmFsc2Ugc28gbm9cbiAgLy8gc2NyaXB0IHJ1bnMgdW5hc2tlZCBmb3IgYSBmbG9hdGluZyBwcm9wZXJ0eS5cbiAgZ2V0VHlwU2hvcnRjdXRzKHR5cCwgeyBpbmNsdWRlRmxvYXRpbmcgPSBmYWxzZSwgc3VidHlwID0gbnVsbCB9ID0ge30pIHtcbiAgICBjb25zdCB7IGRlZmF1bHRzLCBzaG9ydGN1dHMgfSA9IHRoaXMuY29sbGVjdEJsb2Nrcyh0eXAsIHN1YnR5cCwgaW5jbHVkZUZsb2F0aW5nKTtcbiAgICBjb25zdCBzY3JpcHRzID0gdGhpcy5nZXRTaG9ydGN1dFNjcmlwdHM/LigpID8/IFtdO1xuICAgIGNvbnN0IHJlc3VsdCA9IHt9O1xuICAgIGZvciAoY29uc3QgW2tleSwgcmVjb3JkXSBvZiBPYmplY3QuZW50cmllcyhzaG9ydGN1dHMpKSB7XG4gICAgICBjb25zdCBuYW1lID0gc2NyaXB0TmFtZU9mKHJlY29yZC5uYW1lKTtcbiAgICAgIGlmIChuYW1lID09PSBudWxsKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IHNjcmlwdCA9IHNjcmlwdHMuZmluZCgocykgPT4gcy5uYW1lID09PSBuYW1lKTtcbiAgICAgIHJlc3VsdFtrZXldID0ge1xuICAgICAgICBuYW1lLFxuICAgICAgICBwYXJhbXM6IHNjcmlwdD8ucGFyYW1zID8/IG51bGwsXG4gICAgICAgIGFyZ3M6IHsgLi4uKHJlY29yZC5hcmdzID8/IHt9KSB9LFxuICAgICAgICBmYWxsYmFjazogZGVmYXVsdHNba2V5XSA/PyBudWxsLFxuICAgICAgfTtcbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuXG4gIC8vIEZvciBUWVAuanM6IHR1cm5zIGEgc2hvcnRjdXQncyBwYXJhbWV0ZXIgbGlzdCBpbnRvIHRoZSBhcmd1bWVudHMgb2ZcbiAgLy8gdHAudXNlci48bmFtZT4odHAsIC4uLikgLSBzZWUgcmVzb2x2ZUNhbGxBcmdzIGluIHNob3J0Y3V0cy5qcy4gTGl2ZXMgaGVyZVxuICAvLyBzbyB0aGUgcnVsZXMgKHJlc2VydmVkIG5hbWVzLCBkb3R0ZWQgbmFtZXMpIGV4aXN0IGluIG9uZSBwbGFjZTsgb25seVxuICAvLyBUWVAuanMga25vd3MgbmV3RmlsZSBhbmQgY3R4LCBzbyBpdCBwYXNzZXMgdGhlbSBpbi5cbiAgcmVzb2x2ZVNob3J0Y3V0QXJncyhwYXJhbXMsIGFyZ3MsIHsgbmV3RmlsZSA9IG51bGwsIGN0eCA9IG51bGwsIGtleSA9IG51bGwgfSA9IHt9KSB7XG4gICAgcmV0dXJuIHJlc29sdmVDYWxsQXJncyhwYXJhbXMsIGFyZ3MsIHsgbmV3RmlsZSwgY3R4LCBrZXkgfSk7XG4gIH1cblxuICAvLyBGb3IgVFlQLmpzOiByZWdpc3RlcmVkIFN1YnR5cHMgb2YgYSBUWVAgaW4gYmxvY2sgb3JkZXIsIHdpdGggbm90ZSBjb3VudHMuXG4gIC8vIFN1YnR5cHMgdGhhdCBhcmVuJ3QgbWFudWFsbHkgY3JlYXRhYmxlIGFyZSBsZWZ0IG91dCB1bmxlc3NcbiAgLy8gaW5jbHVkZU1hbnVhbE9mZiBpcyBzZXQsIGxpa2Ugc3VjaCBUWVAgZW50cmllcyBpbiBnZXRUeXBzKCkuXG4gIGdldFN1YnR5cHModHlwLCB7IGluY2x1ZGVNYW51YWxPZmYgPSBmYWxzZSB9ID0ge30pIHtcbiAgICBjb25zdCB7IGNvdW50cyB9ID0gdGhpcy50eXBJbmRleC5zdWJ0eXBCdWNrZXQodHlwKTtcbiAgICByZXR1cm4gZ2V0U3VidHlwTmFtZXModGhpcy5zZXR0aW5ncywgdHlwKVxuICAgICAgLmZpbHRlcigoc3VidHlwKSA9PiBpbmNsdWRlTWFudWFsT2ZmIHx8IGlzU3VidHlwTWFudWFsKHRoaXMuc2V0dGluZ3MsIHR5cCwgc3VidHlwKSlcbiAgICAgIC5tYXAoKHN1YnR5cCkgPT4gKHsgc3VidHlwLCBjb3VudDogY291bnRzLmdldChzdWJ0eXApID8/IDAgfSkpO1xuICB9XG5cbiAgLy8gRm9yIFRZUC5qczogdGhlIFN1YnR5cC1QaWNrZXIgKHNlZSB0eXAtcGlja2VyLmpzKS4gUmVzb2x2ZXMgd2l0aCB0aGVcbiAgLy8gU3VidHlwLCBcIlwiIGZvciBcIm5vIFN1YnR5cFwiIChvciB3aXRob3V0IGEgcGlja2VyIGlmIHRoZSBUWVAgaGFzIG5vbmUpLCBvclxuICAvLyBudWxsIG9uIEVTQyAoVFlQLmpzIHRoZW4gZ29lcyBiYWNrIHRvIHRoZSBUWVAgY2hvaWNlKS4gcXVlcnkgKG9wdGlvbmFsKTpcbiAgLy8gYW4gYWxyZWFkeSB0eXBlZCBzZWFyY2ggdGhhdCBwcmUtc29ydHMgdGhlIGxpc3QuIG9wdGlvbnMgYXMgaW4gZ2V0U3VidHlwcy5cbiAgcGlja1N1YnR5cCh0eXAsIHF1ZXJ5ID0gXCJcIiwgb3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIHBpY2tTdWJ0eXBNb2RhbCh0aGlzLmFwcCwgdGhpcywgdHlwLCBxdWVyeSwgb3B0aW9ucyk7XG4gIH1cblxuICAvLyBGb3IgVFlQLmpzLCBpbnNpZGUgcHJvY2Vzc0Zyb250TWF0dGVyOiBzZXRzIFRZUCBhbmQgU1VCVFlQIGluIGNhbm9uaWNhbFxuICAvLyBzcGVsbGluZyAtIGEgdmFyaWFudCBsaWtlIFwidHlwXCIgb3IgXCJTdWJ0eXBcIiBpcyByZW5hbWVkIGluIHBsYWNlIHJhdGhlciB0aGFuXG4gIC8vIGR1cGxpY2F0ZWQuIHN1YnR5cCBudWxsIHJlbW92ZXMgYW4gZXhpc3RpbmcgU1VCVFlQLlxuICBhcHBseVR5cFByb3BlcnRpZXMoZnJvbnRtYXR0ZXIsIHR5cCwgc3VidHlwKSB7XG4gICAgc2V0Q2Fub25pY2FsUHJvcGVydHkoZnJvbnRtYXR0ZXIsIFRZUF9QUk9QRVJUWSwgdHlwKTtcbiAgICBpZiAoc3VidHlwKSBzZXRDYW5vbmljYWxQcm9wZXJ0eShmcm9udG1hdHRlciwgU1VCVFlQX1BST1BFUlRZLCBzdWJ0eXApO1xuICAgIGVsc2UgZGVsZXRlUHJvcGVydHkoZnJvbnRtYXR0ZXIsIFNVQlRZUF9QUk9QRVJUWSk7XG4gIH1cblxuICAvLyBGb3IgVFlQLmpzLCBpbnNpZGUgcHJvY2Vzc0Zyb250TWF0dGVyIGFuZCBhZnRlciBhbGwgb3RoZXIgY2hhbmdlczogcHV0cyB0aGVcbiAgLy8gZnJvbnRtYXR0ZXIgaW50byBzb3J0aW5nIG9yZGVyLCBvciBuZXdseSBhZGRlZCBwcm9wZXJ0aWVzIChTVUJUWVAgaW4gYW5cbiAgLy8gZXhpc3Rpbmcgbm90ZSwgc2F5KSB3b3VsZCBlbmQgdXAgbGFzdC5cbiAgc29ydEZyb250bWF0dGVyKGZyb250bWF0dGVyLCB0eXAsIHN1YnR5cCA9IG51bGwpIHtcbiAgICByZXR1cm4gc29ydEZyb250bWF0dGVyRm9yKHRoaXMsIGZyb250bWF0dGVyLCB0eXAsIHN1YnR5cCk7XG4gIH1cblxuICAvLyBJbnNpZGUgcHJvY2Vzc0Zyb250TWF0dGVyOiBtb3ZlcyBvbmx5IHByb3BlcnR5IGBrZXlgIHRvIGl0cyBzb3J0ZWQgcGxhY2VcbiAgLy8gKFRZUC9TVUJUWVAgcmVhZCBmcm9tIHRoZSBvYmplY3QpLCBldmVyeXRoaW5nIGVsc2Ugc3RheXMgLSBmb3IgRnJlZCdzXG4gIC8vIHByb3BlcnR5IGJhY2tsaW5raW5nLCBzbyBhIG5ldyBwcm9wZXJ0eSBkb2Vzbid0IGVuZCB1cCBsYXN0LlxuICBwbGFjZVByb3BlcnR5KGZyb250bWF0dGVyLCBrZXkpIHtcbiAgICByZXR1cm4gcGxhY2VQcm9wZXJ0eUZvcih0aGlzLCBmcm9udG1hdHRlciwga2V5KTtcbiAgfVxuXG4gIC8vIEZvciBUWVAuanM6IHRoZSByZWdpc3RlcmVkIFRZUCBlbnRyaWVzIHdpdGggdGhlaXIgZGVzY3JpcHRpb25zLCBpbiB0aGVcbiAgLy8gb3JkZXIgb2YgdGhlIFRZUC1MaXN0IChpdHMgY3VycmVudCBzb3J0IHNldHRpbmcpLiBUWVAgZW50cmllcyB0aGF0IGFyZW4ndFxuICAvLyBtYW51YWxseSBjcmVhdGFibGUgYXJlIGxlZnQgb3V0IHVubGVzcyBpbmNsdWRlTWFudWFsT2ZmIGlzIHRydWUuXG4gIGdldFR5cHMoeyBpbmNsdWRlTWFudWFsT2ZmID0gZmFsc2UgfSA9IHt9KSB7XG4gICAgY29uc3QgeyBjb3VudHMgfSA9IHRoaXMudHlwSW5kZXgudHlwQ291bnRzKCk7XG4gICAgY29uc3Qgc29ydE9yZGVyID0gdGhpcy5zZXR0aW5ncy50eXBTb3J0T3JkZXIgPz8gREVGQVVMVF9TT1JUX09SREVSO1xuICAgIHJldHVybiBzb3J0VHlwc0J5TW9kZSh0aGlzLnNldHRpbmdzLnR5cHMsIHNvcnRPcmRlciwgY291bnRzLCB0aGlzLnNldHRpbmdzLnR5cENvbG9ycylcbiAgICAgIC5maWx0ZXIoKHR5cCkgPT4gaW5jbHVkZU1hbnVhbE9mZiB8fCAodGhpcy5zZXR0aW5ncy50eXBNYW51YWwgPz8ge30pW3R5cF0gIT09IGZhbHNlKVxuICAgICAgLm1hcCgodHlwKSA9PiAoe1xuICAgICAgICB0eXAsXG4gICAgICAgIGRlc2NyaXB0aW9uOiB0aGlzLnNldHRpbmdzLnR5cERlc2NyaXB0aW9uc1t0eXBdID8/IFwiXCIsXG4gICAgICAgIGNvdW50OiBjb3VudHMuZ2V0KHR5cCkgPz8gMCxcbiAgICAgIH0pKTtcbiAgfVxuXG4gIC8vIEZvciBUWVAuanM6IHRoZSBuYXRpdmUgVFlQLVBpY2tlciAoc2VlIHR5cC1waWNrZXIuanMpIHdpdGggY29sb3IsXG4gIC8vIGRlc2NyaXB0aW9uIGFuZCBub3RlIGNvdW50LiBpbmNsdWRlTWFudWFsT2ZmIGFzIGluIGdldFR5cHMoKS4gUmVzb2x2ZXNcbiAgLy8gd2l0aCB0aGUgVFlQLCBvciBudWxsIG9uIEVTQy5cbiAgcGlja1R5cChvcHRpb25zKSB7XG4gICAgcmV0dXJuIHBpY2tUeXBNb2RhbCh0aGlzLmFwcCwgdGhpcywgb3B0aW9ucyk7XG4gIH1cblxuICAvLyBGb3IgVFlQLmpzOiBUWVAgYW5kIFN1YnR5cCBpbiBvbmUgZ28gKHNlZSB0eXAtcGlja2VyLmpzKSAtIG9uZSBwaWNrZXIgd2l0aFxuICAvLyBpbmRlbnRlZCBTdWJ0eXBzIG9yIGJvdGggcGlja2VycyBpbiB0dXJuLCBwZXIgXCJTZXBhcmF0ZSBTdWJ0eXAtUGlja2VyXCIuXG4gIC8vIFJlc29sdmVzIHdpdGggeyB0eXAsIHN1YnR5cCB9IChzdWJ0eXAgbnVsbCBmb3IgXCJubyBTdWJ0eXBcIiksIG9yIG51bGwgb25cbiAgLy8gRVNDLlxuICBwaWNrVHlwQW5kU3VidHlwKG9wdGlvbnMpIHtcbiAgICByZXR1cm4gcGlja1R5cEFuZFN1YnR5cE1vZGFsKHRoaXMuYXBwLCB0aGlzLCBvcHRpb25zKTtcbiAgfVxuXG4gIC8vIGRhdGE6IHdoYXQgbG9hZERhdGEoKSByZXR1cm5lZCwgaWYgdGhlIGNhbGxlciBhbHJlYWR5IGhhcyBpdCAob25sb2FkKTtcbiAgLy8gd2l0aG91dCBpdCAob25FeHRlcm5hbFNldHRpbmdzQ2hhbmdlKSBkYXRhLmpzb24gaXMgcmVhZCBoZXJlLlxuICBhc3luYyBsb2FkU2V0dGluZ3MoZGF0YSkge1xuICAgIGlmIChkYXRhID09PSB1bmRlZmluZWQpIGRhdGEgPSBhd2FpdCB0aGlzLmxvYWREYXRhKCk7XG4gICAgLy8gQSBkZWVwIGNvcHkgYXMgdGhlIGJhc2U6IHdpdGhvdXQgZGF0YS5qc29uIChhIGZyZXNoIGluc3RhbGwpIG9yIHdpdGgga2V5c1xuICAgIC8vIG1pc3NpbmcgZnJvbSBpdCwgc2V0dGluZ3MudHlwcywgdHlwQ29sb3JzIGFuZCBzbyBvbiB3b3VsZCBvdGhlcndpc2UgQkVcbiAgICAvLyB0aGUgb2JqZWN0cyBpbiBERUZBVUxUX1NFVFRJTkdTLCBhbmQgZXZlcnkgY2hhbmdlIHdvdWxkIGFsdGVyIHRoZVxuICAgIC8vIGRlZmF1bHRzIGFsb25nIHdpdGggdGhlbS5cbiAgICB0aGlzLnNldHRpbmdzID0gT2JqZWN0LmFzc2lnbihzdHJ1Y3R1cmVkQ2xvbmUoREVGQVVMVF9TRVRUSU5HUyksIGRhdGEpO1xuICAgIC8vIE9iamVjdC5hc3NpZ24gcmVwbGFjZXMgbmVzdGVkIG9iamVjdHMgd2hvbGU7IHZpZXdzIGFkZGVkIGxhdGVyIChlLmcuXG4gICAgLy8gY29sb3JWaWV3cy5saW5rcykgd291bGQgb3RoZXJ3aXNlIGJlIHNpbGVudGx5IG9mZiBpbiBvbGRlciBzZXR0aW5ncy5cbiAgICB0aGlzLnNldHRpbmdzLmNvbG9yVmlld3MgPSB7IC4uLkRFRkFVTFRfU0VUVElOR1MuY29sb3JWaWV3cywgLi4udGhpcy5zZXR0aW5ncy5jb2xvclZpZXdzIH07XG4gICAgdGhpcy5zZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyID0gbm9ybWFsaXplR2xvYmFsT3JkZXIodGhpcy5zZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyKTtcbiAgfVxuXG4gIC8vIHNldHRpbmdzUmV2aXNpb24gY291bnRzIGV2ZXJ5IGNoYW5nZSBvZiB0aGUgc2V0dGluZ3MgKGhlcmUgYW5kIGluXG4gIC8vIG9uRXh0ZXJuYWxTZXR0aW5nc0NoYW5nZSkuIFVuZG8gKHVuZG8uanMpIGNvbXBhcmVzIGl0IHRvIHRlbGwgd2hldGhlclxuICAvLyBhbnl0aGluZyBoYXBwZW5lZCBhZnRlciB0aGUgYWN0aW9uIGl0IHdvdWxkIHJldmVydC4gQnVtcGVkIHN5bmNocm9ub3VzbHksXG4gIC8vIGJlZm9yZSB0aGUgYXdhaXQsIHNvIGEgY2FsbGVyIHRoYXQgZG9lc24ndCBhd2FpdCBzdGlsbCBjb3VudHMgYXQgb25jZS5cbiAgYXN5bmMgc2F2ZVNldHRpbmdzKCkge1xuICAgIHRoaXMuc2V0dGluZ3NSZXZpc2lvbiA9ICh0aGlzLnNldHRpbmdzUmV2aXNpb24gPz8gMCkgKyAxO1xuICAgIGF3YWl0IHRoaXMuc2F2ZURhdGEodGhpcy5zZXR0aW5ncyk7XG4gIH1cblxuICAvLyBDYWxsZWQgd2hlbiBkYXRhLmpzb24gY2hhbmdlcyBmcm9tIG91dHNpZGUsIGluIHByYWN0aWNlIHRocm91Z2ggT2JzaWRpYW5cbiAgLy8gU3luYy4gV2l0aG91dCBpdCB0aGlzIGRldmljZSB3b3VsZCBrZWVwIGl0cyBvbGQgc2V0dGluZ3MgaW4gbWVtb3J5IGFuZFxuICAvLyBvdmVyd3JpdGUgdGhlIG5ldyBvbmVzIG9uIHRoZSBuZXh0IHNhdmUuIE9ic2lkaWFuIHJlYnVpbGRzIGFuIG9wZW5cbiAgLy8gc2V0dGluZ3MgdGFiIGl0c2VsZjsgY29sb3JzIGFuZCB0aGUgVFlQLVBhbmUgYXJlIHJlZnJlc2hlZCBoZXJlLlxuICBhc3luYyBvbkV4dGVybmFsU2V0dGluZ3NDaGFuZ2UoKSB7XG4gICAgLy8gSW52YWxpZGF0ZXMgYSBwZW5kaW5nIHVuZG86IGl0cyBzbmFwc2hvdCBwcmVkYXRlcyB0aGUgc3luY2VkIHNldHRpbmdzLlxuICAgIHRoaXMuc2V0dGluZ3NSZXZpc2lvbiA9ICh0aGlzLnNldHRpbmdzUmV2aXNpb24gPz8gMCkgKyAxO1xuICAgIGF3YWl0IHRoaXMubG9hZFNldHRpbmdzKCk7XG4gICAgdGhpcy5yZWZyZXNoVHlwQ29sb3JzKCk7XG4gIH1cbn07XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7QUFBQTtBQUFBLHFCQUFBQSxVQUFBQyxTQUFBO0FBQUEsUUFBTSxFQUFFLFFBQVEsT0FBTyxTQUFTLElBQUksUUFBUSxVQUFVO0FBRXRELFFBQU1DLGdCQUFlO0FBQ3JCLFFBQU1DLG1CQUFrQjtBQUN4QixRQUFNLGNBQWMsT0FBTyxPQUFPLEVBQUUsUUFBUSxNQUFNLFFBQVEsTUFBTSxXQUFXLE1BQU0sV0FBVyxLQUFLLENBQUM7QUFLbEcsUUFBTSxpQkFBaUI7QUFFdkIsYUFBUyxRQUFRLE9BQU87QUFDdEIsVUFBSSxTQUFTLEtBQU0sUUFBTztBQUMxQixhQUFPLE9BQU8sVUFBVSxXQUFXLEtBQUssVUFBVSxLQUFLLElBQUksT0FBTyxLQUFLO0FBQUEsSUFDekU7QUFTQSxhQUFTLFNBQVMsT0FBTztBQUN2QixVQUFJLE1BQU0sUUFBUSxLQUFLLEdBQUc7QUFDeEIsY0FBTSxRQUFRLE1BQU0sSUFBSSxPQUFPO0FBQy9CLFlBQUksTUFBTSxNQUFNLENBQUMsU0FBUyxLQUFLLEtBQUssTUFBTSxFQUFFLEVBQUcsUUFBTztBQUN0RCxlQUFPLElBQUksTUFBTSxLQUFLLElBQUksQ0FBQztBQUFBLE1BQzdCO0FBQ0EsWUFBTSxPQUFPLFFBQVEsS0FBSztBQUMxQixhQUFPLEtBQUssS0FBSyxNQUFNLEtBQUssT0FBTztBQUFBLElBQ3JDO0FBS0EsYUFBUyxjQUFjLGFBQWEsTUFBTTtBQUN4QyxVQUFJLENBQUMsWUFBYSxRQUFPO0FBQ3pCLFVBQUksT0FBTyxVQUFVLGVBQWUsS0FBSyxhQUFhLElBQUksRUFBRyxRQUFPO0FBQ3BFLFlBQU0sUUFBUSxLQUFLLFlBQVk7QUFDL0IsYUFBTyxPQUFPLEtBQUssV0FBVyxFQUFFLEtBQUssQ0FBQyxRQUFRLElBQUks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SztBQUN2RCxVQUFNLEtBQUssU0FBUyxLQUFLLFFBQVE7QUFBQSxFQUNuQztBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFNQSxNQUFNLDJCQUEyQjtBQUUvQixTQUFLLG9CQUFvQixLQUFLLG9CQUFvQixLQUFLO0FBQ3ZELFVBQU0sS0FBSyxhQUFhO0FBQ3hCLFNBQUssaUJBQWlCO0FBQUEsRUFDeEI7QUFDRjsiLAogICJuYW1lcyI6IFsiZXhwb3J0cyIsICJtb2R1bGUiLCAiVFlQX1BST1BFUlRZIiwgIlNVQlRZUF9QUk9QRVJUWSIsICJzZXRDYW5vbmljYWxQcm9wZXJ0eSIsICJkZWxldGVQcm9wZXJ0eSIsICJUeXBJbmRleCIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJzZXRDYW5vbmljYWxQcm9wZXJ0eSIsICJTVUJUWVBfUFJPUEVSVFkiLCAiZ2V0U3VidHlwTmFtZXMiLCAiZ2V0U3VidHlwIiwgImlzU3VidHlwTWFudWFsIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInNvcnRUeXBzQnlNb2RlIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgImdldFN1YnR5cCIsICJjbGVhcklubGluZUNvbG9ycyIsICJhbGxEb2N1bWVudHMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiZ2V0U3VidHlwIiwgIlRZUF9QUk9QRVJUWSIsICJTVUJUWVBfUFJPUEVSVFkiLCAibm9ybWFsaXplR2xvYmFsT3JkZXIiLCAic29ydEZyb250bWF0dGVyRm9yIiwgInBsYWNlUHJvcGVydHlGb3IiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiVFlQX1BST1BFUlRZIiwgIlNVQlRZUF9QUk9QRVJUWSIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJERUZBVUxUX1NFVFRJTkdTIiwgIlR5cFN5c3RlbVNldHRpbmdUYWIiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiZ2V0U3VidHlwTmFtZXMiLCAibm9ybWFsaXplR2xvYmFsT3JkZXIiLCAiVFlQX1BST1BFUlRZIiwgIlNVQlRZUF9QUk9QRVJUWSIsICJsZWFmIiwgImN1cnJlbnQiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAicmVnaXN0ZXJDb21tYW5kcyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJzY3JpcHROYW1lT2YiLCAicmVzb2x2ZUNhbGxBcmdzIiwgInJlc29sdmVTaG9ydGN1dHMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAic2NyaXB0TmFtZU9mIiwgImdldFN1YnR5cCIsICJUWVBfUFJPUEVSVFkiLCAiU1VCVFlQX1BST1BFUlRZIiwgInJlbW92ZVByb3BlcnR5TWVudVBhdGNoIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgImdldFN1YnR5cE5hbWVzIiwgImdldFN1YnR5cCIsICJpc1N1YnR5cE1hbnVhbCIsICJzb3J0VHlwc0J5TW9kZSIsICJzZXRDYW5vbmljYWxQcm9wZXJ0eSIsICJUWVBfUFJPUEVSVFkiLCAiU1VCVFlQX1BST1BFUlRZIiwgIkRFRkFVTFRfU09SVF9PUkRFUiIsICJyZWdpc3RlclR5cFBhbmUiLCAibGVhZiIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJyZWdpc3RlckZpbGVFeHBsb3JlckNvbG9ycyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJyZWdpc3RlckdyYXBoQ29sb3JzIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInJlZ2lzdGVyU2VhcmNoQ29sb3JzIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInJlZ2lzdGVyUmVjZW50RmlsZXNDb2xvcnMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAicmVnaXN0ZXJCYWNrbGlua0NvbG9ycyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJyZWdpc3RlckJvb2ttYXJrc0NvbG9ycyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJnZXRTdWJ0eXAiLCAicmVnaXN0ZXJBY3RpdmVUaXRsZUNvbG9ycyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJhbGxEb2N1bWVudHMiLCAicmVnaXN0ZXJMaW5rQ29sb3JzIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgImdldFN1YnR5cE5hbWVzIiwgImdldFN1YnR5cCIsICJhbGxEb2N1bWVudHMiLCAiZmxvYXRpbmciLCAicmVnaXN0ZXJGcm9udG1hdHRlckRlZmF1bHRIaWdobGlnaHQiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiZ2V0U3VidHlwTmFtZXMiLCAiVFlQX1BST1BFUlRZIiwgIlNVQlRZUF9QUk9QRVJUWSIsICJyZWdpc3RlclByb3BlcnR5UmVuYW1lU3luYyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJERUZBVUxUX1NPUlRfT1JERVIiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAicmVnaXN0ZXJTaG9ydGN1dFNjcmlwdHMiXQp9Cg==
