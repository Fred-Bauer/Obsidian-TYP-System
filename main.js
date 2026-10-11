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
    function coalesceFrame(fn) {
      let frame = null;
      let win = null;
      const schedule = () => {
        if (frame !== null) return;
        win = window.activeWindow ?? window;
        frame = win.requestAnimationFrame(() => {
          frame = null;
          fn();
        });
      };
      schedule.cancel = () => {
        if (frame !== null) win.cancelAnimationFrame(frame);
        frame = null;
      };
      return schedule;
    }
    module2.exports = {
      normalizeTypName,
      plural,
      joinAnd,
      pickerInstructions,
      hexToHue,
      compareTyps,
      sortTypsByMode: sortTypsByMode2,
      coalesceFrame
    };
  }
});

// src/frontmatter-text.js
var require_frontmatter_text = __commonJS({
  "src/frontmatter-text.js"(exports2, module2) {
    var { parseYaml, stringifyYaml, getFrontMatterInfo } = require("obsidian");
    var { setCanonicalProperty: setCanonicalProperty2, deleteProperty: deleteProperty2 } = require_typ_index();
    var { plural } = require_typ_utils();
    var UnsafeEdit = class extends Error {
    };
    var BOM = "\uFEFF";
    function splitLines(text) {
      return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
    }
    function stripEol(line) {
      return line.replace(/\r?\n$/, "");
    }
    var isBlank = (line) => /^[ \t]*$/.test(stripEol(line));
    var isColumnZeroComment = (line) => line.startsWith("#");
    var isKeyLine = (line) => !/^[ \t#\r\n]/.test(line) && line !== "" && !/^-([ \t]|\r?$)/.test(stripEol(line));
    var mayHaveComment = (line) => /(^|[ \t])#/.test(stripEol(line));
    function isPlainObject(value) {
      return value !== null && typeof value === "object" && !Array.isArray(value);
    }
    function sameValue(a, b) {
      if (Object.is(a, b)) return true;
      if (Array.isArray(a)) {
        return Array.isArray(b) && a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
      }
      if (isPlainObject(a) && isPlainObject(b)) {
        const keysA = Object.keys(a);
        const keysB = Object.keys(b);
        return keysA.length === keysB.length && keysA.every((key, i) => key === keysB[i] && sameValue(a[key], b[key]));
      }
      return false;
    }
    function tryParse(text) {
      try {
        return parseYaml(text);
      } catch {
        return void 0;
      }
    }
    function locateBlock(content) {
      const bom = content.startsWith(BOM) ? BOM : "";
      const text = content.slice(bom.length);
      const info = getFrontMatterInfo(text);
      const offset = bom.length;
      if (!info.exists) {
        const firstEol = text.match(/\r?\n/);
        return { exists: false, bom, eol: firstEol ? firstEol[0] : "\n", from: offset, to: offset, contentStart: offset };
      }
      const eol = text.slice(3, info.from) || "\n";
      return {
        exists: true,
        bom,
        eol,
        from: offset + info.from,
        to: offset + info.to,
        contentStart: offset + info.contentStart,
        block: info.frontmatter
      };
    }
    function cutBlock(block, whole) {
      const lines = splitLines(block);
      const units = [];
      let pending = [];
      let current = null;
      for (const line of lines) {
        if (isKeyLine(line)) {
          current = { lines: [line], leading: pending };
          units.push(current);
          pending = [];
        } else if (isBlank(line) || isColumnZeroComment(line)) {
          pending.push(line);
        } else {
          if (!current) return null;
          current.lines.push(...pending, line);
          pending = [];
        }
      }
      let header = [];
      if (units.length === 0) {
        header = pending;
        pending = [];
      } else {
        const leading = units[0].leading;
        let lastBlank = -1;
        leading.forEach((line, i) => {
          if (isBlank(line)) lastBlank = i;
        });
        header = leading.slice(0, lastBlank + 1);
        units[0].leading = leading.slice(lastBlank + 1);
      }
      const footer = pending;
      const wholeObject = whole ?? {};
      if (!isPlainObject(wholeObject)) return null;
      const wholeKeys = Object.keys(wholeObject);
      if (wholeKeys.length !== units.length) return null;
      for (const [i, unit] of units.entries()) {
        const parsed = tryParse(unit.lines.join(""));
        if (!isPlainObject(parsed)) return null;
        const keys = Object.keys(parsed);
        if (keys.length !== 1 || keys[0] !== wholeKeys[i]) return null;
        if (!sameValue(parsed[keys[0]], wholeObject[keys[0]])) return null;
        unit.key = keys[0];
        unit.value = parsed[keys[0]];
      }
      return { header, units, footer };
    }
    function isBlankValue(value) {
      return value === null || value === void 0 || value === "" || Array.isArray(value) && value.length === 0;
    }
    function planRename(keys, get, oldName, newName) {
      const oldLower = oldName.toLowerCase();
      const newLower = newName.toLowerCase();
      const sources = keys.filter((key) => key.toLowerCase() === oldLower);
      if (sources.length === 0) return null;
      const targets = newLower === oldLower ? [] : keys.filter((key) => key.toLowerCase() === newLower);
      const group = [...targets, ...sources];
      const filled = group.filter((key) => !isBlankValue(get(key)));
      if (filled.some((key) => !sameValue(get(key), get(filled[0])))) return "conflict";
      const kept = filled[0] ?? group[0];
      if (group.length === 1 && kept === newName) return null;
      return { kept, dropped: group.filter((key) => key !== kept) };
    }
    function keyPrefixLength(line, key) {
      for (let i = line.indexOf(":"); i !== -1; i = line.indexOf(":", i + 1)) {
        const parsed = tryParse(line.slice(0, i + 1));
        if (isPlainObject(parsed) && Object.keys(parsed).length === 1 && Object.keys(parsed)[0] === key) return i + 1;
      }
      return -1;
    }
    function keyText(name) {
      const line = stripEol(splitLines(stringifyYaml({ [name]: null }))[0] ?? "");
      const length = keyPrefixLength(line, name);
      if (length < 0) throw new UnsafeEdit();
      return line.slice(0, length);
    }
    function inlineComment(lineText, expected) {
      const pattern = /[ \t]#/g;
      let match;
      while (match = pattern.exec(lineText)) {
        const left = lineText.slice(0, match.index).replace(/[ \t]+$/, "");
        if (sameValue(tryParse(left), expected)) return lineText.slice(left.length);
      }
      return "";
    }
    var TextDoc = class {
      constructor(location, cut) {
        this.location = location;
        this.header = cut?.header ?? [];
        this.units = cut?.units ?? [];
        this.footer = cut?.footer ?? [];
      }
      keys() {
        return this.units.map((unit) => unit.key);
      }
      has(key) {
        return this.units.some((unit) => unit.key === key);
      }
      get(key) {
        return this.units.find((unit) => unit.key === key)?.value;
      }
      // Actual spelling of `name` in this note: the exact one first, otherwise
      // any case (like propertyKeyOf in typ-index.js).
      findKey(name) {
        if (this.has(name)) return name;
        const lower = name.toLowerCase();
        return this.keys().find((key) => key.toLowerCase() === lower);
      }
      toObject() {
        const object = {};
        for (const unit of this.units) object[unit.key] = unit.value;
        return object;
      }
      // Lines of a new unit `name: value`, in the block's line ending.
      newLines(name, value) {
        const { eol } = this.location;
        return splitLines(stringifyYaml({ [name]: value })).map((line) => stripEol(line) + eol);
      }
      // Like setCanonicalProperty: writes value under the spelling `name`. The
      // first variant in another case ("typ" for "TYP") is renamed in place,
      // further variants are dropped (their leading lines join the kept unit). A
      // missing property is added at the end; sorting puts it in place.
      //
      // A replaced single-line unit keeps its inline comment. A multi-line unit
      // with a comment inside can't be replaced without losing it: UnsafeEdit.
      set(name, value) {
        const lower = name.toLowerCase();
        const variants = this.units.filter((unit) => unit.key.toLowerCase() === lower);
        if (variants.length === 0) {
          this.units.push({ key: name, value, lines: this.newLines(name, value), leading: [] });
          return;
        }
        const [kept, ...dropped] = variants;
        for (const unit of dropped) {
          if (unit.lines.some(mayHaveComment)) throw new UnsafeEdit();
          kept.leading.push(...unit.leading);
          this.units.splice(this.units.indexOf(unit), 1);
        }
        if (kept.key === name && sameValue(kept.value, value)) return;
        const lines = this.newLines(name, value);
        if (kept.lines.length === 1) {
          const oldLine = kept.lines[0];
          const comment = inlineComment(stripEol(oldLine), { [kept.key]: kept.value });
          if (comment) {
            if (lines.length !== 1) throw new UnsafeEdit();
            lines[0] = stripEol(lines[0]) + comment + oldLine.slice(stripEol(oldLine).length);
          } else {
            lines[0] = stripEol(lines[0]) + oldLine.slice(stripEol(oldLine).length);
          }
        } else if (kept.lines.some(mayHaveComment)) {
          throw new UnsafeEdit();
        }
        Object.assign(kept, { key: name, value, lines });
      }
      // Like deleteProperty: removes `name` in every spelling, with the comments
      // above it (they belong to it).
      delete(name) {
        const lower = name.toLowerCase();
        this.units = this.units.filter((unit) => unit.key.toLowerCase() !== lower);
      }
      // Renames oldName (any spelling) to newName, see planRename; false on a
      // conflict, with nothing changed. Only the key of the kept unit changes -
      // value, inline comment and nested lines stay byte for byte. The comments
      // above a dropped unit join the kept one (as in set()); a dropped unit with
      // a comment inside can't go without losing it: UnsafeEdit.
      rename(oldName, newName) {
        const plan = planRename(this.keys(), (key) => this.get(key), oldName, newName);
        if (plan === "conflict") return false;
        if (plan === null) return true;
        const unitOf = (key) => this.units.find((unit) => unit.key === key);
        const kept = unitOf(plan.kept);
        const dropped = plan.dropped.map(unitOf);
        if (dropped.some((unit) => unit.lines.some(mayHaveComment))) throw new UnsafeEdit();
        for (const unit of dropped) {
          kept.leading.push(...unit.leading);
          this.units.splice(this.units.indexOf(unit), 1);
        }
        if (kept.key !== newName) {
          const [first, ...rest] = kept.lines;
          const length = keyPrefixLength(first, kept.key);
          if (length < 0) throw new UnsafeEdit();
          kept.lines = [keyText(newName) + first.slice(length), ...rest];
          kept.key = newName;
        }
        return true;
      }
      // keys: the new order, a permutation of keys().
      reorder(keys) {
        const byKey = new Map(this.units.map((unit) => [unit.key, unit]));
        if (keys.length !== this.units.length || !keys.every((key) => byKey.has(key))) {
          throw new Error("reorder: keys don't match the frontmatter");
        }
        this.units = keys.map((key) => byKey.get(key));
      }
      // The new file content, or null if the result doesn't parse back to the
      // expected properties (then nothing may be written).
      render(content) {
        const { location } = this;
        const unitText = this.units.map((unit) => unit.leading.join("") + unit.lines.join("")).join("");
        const block = this.header.join("") + unitText + this.footer.join("");
        const reparsed = tryParse(block);
        if (reparsed === void 0 || !sameValue(reparsed ?? {}, this.toObject())) return null;
        const { bom, eol } = location;
        if (!location.exists) {
          if (this.units.length === 0) return content;
          return bom + "---" + eol + block + "---" + eol + content.slice(bom.length);
        }
        if (block === location.block) return content;
        if (block === "") return bom + content.slice(location.contentStart);
        return content.slice(0, location.from) + block + content.slice(location.to);
      }
    };
    var ObjectDoc = class {
      constructor(object) {
        this.object = object;
        this.changed = false;
      }
      keys() {
        return Object.keys(this.object);
      }
      has(key) {
        return Object.prototype.hasOwnProperty.call(this.object, key);
      }
      get(key) {
        return this.has(key) ? this.object[key] : void 0;
      }
      findKey(name) {
        if (this.has(name)) return name;
        const lower = name.toLowerCase();
        return this.keys().find((key) => key.toLowerCase() === lower);
      }
      toObject() {
        return { ...this.object };
      }
      set(name, value) {
        const lower = name.toLowerCase();
        const variants = this.keys().filter((key) => key.toLowerCase() === lower);
        if (variants.length === 1 && variants[0] === name && sameValue(this.object[name], value)) return;
        setCanonicalProperty2(this.object, name, value);
        this.changed = true;
      }
      delete(name) {
        if (this.findKey(name) === void 0) return;
        deleteProperty2(this.object, name);
        this.changed = true;
      }
      rename(oldName, newName) {
        const plan = planRename(this.keys(), (key) => this.object[key], oldName, newName);
        if (plan === "conflict") return false;
        if (plan === null) return true;
        const keys = this.keys();
        const snapshot = { ...this.object };
        for (const key of keys) delete this.object[key];
        for (const key of keys) {
          if (key === plan.kept) this.object[newName] = snapshot[key];
          else if (!plan.dropped.includes(key)) this.object[key] = snapshot[key];
        }
        this.changed = true;
        return true;
      }
      reorder(keys) {
        const current = this.keys();
        if (keys.length !== current.length || !keys.every((key) => this.has(key))) {
          throw new Error("reorder: keys don't match the frontmatter");
        }
        if (keys.every((key, i) => key === current[i])) return;
        const snapshot = { ...this.object };
        for (const key of current) delete this.object[key];
        for (const key of keys) this.object[key] = snapshot[key];
        this.changed = true;
      }
    };
    function editAsObject(content, location, whole, mutate) {
      if (whole === void 0) return null;
      const object = whole ?? {};
      if (!isPlainObject(object)) return null;
      const doc = new ObjectDoc(object);
      mutate(doc);
      if (!doc.changed) return content;
      const { bom, eol } = location;
      if (Object.keys(object).length === 0) {
        return location.exists ? bom + content.slice(location.contentStart) : content;
      }
      const block = stringifyYaml(object).replace(/\r?\n/g, eol);
      if (!location.exists) return bom + "---" + eol + block + "---" + eol + content.slice(bom.length);
      return content.slice(0, location.from) + block + content.slice(location.to);
    }
    function editFrontmatterText(content, mutate) {
      const location = locateBlock(content);
      const block = location.exists ? location.block : "";
      const whole = tryParse(block);
      const hasComments = splitLines(block).some(mayHaveComment);
      const cut = whole === void 0 ? null : cutBlock(block, whole);
      if (cut) {
        const doc = new TextDoc(location, cut);
        let result2 = null;
        try {
          mutate(doc);
          result2 = doc.render(content);
        } catch (error) {
          if (!(error instanceof UnsafeEdit)) throw error;
        }
        if (result2 !== null) return { status: result2 === content ? "unchanged" : "changed", content: result2 };
      }
      const result = editAsObject(content, location, whole, mutate);
      if (result === null) return { status: "skipped", content };
      if (result === content) return { status: "unchanged", content };
      if (hasComments) return { status: "skipped", content };
      return { status: "changed", content: result };
    }
    async function editFrontmatter(app, file, mutate) {
      let status = "unchanged";
      await app.vault.process(file, (content) => {
        const result = editFrontmatterText(content, mutate);
        status = result.status;
        return result.content;
      });
      return { status };
    }
    function skippedText(skipped, action) {
      if (!skipped) return "";
      return ` ${plural(skipped, "note")} skipped (frontmatter can't be ${action} without losing comments).`;
    }
    module2.exports = { editFrontmatter, editFrontmatterText, skippedText };
  }
});

// src/subtyps.js
var require_subtyps = __commonJS({
  "src/subtyps.js"(exports2, module2) {
    var { typKeyOf, propertyValue, SUBTYP_PROPERTY: SUBTYP_PROPERTY2 } = require_typ_index();
    var { editFrontmatter } = require_frontmatter_text();
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
    function mergeBlockInto(target, source) {
      const targetKeys = new Map(Object.keys(target.frontmatter).map((key) => [key.toLowerCase(), key]));
      for (const [key, value] of Object.entries(source.frontmatter)) {
        if (key === "") continue;
        const existing = targetKeys.get(key.toLowerCase());
        if (existing !== void 0) {
          if (isEmptyValue(target.frontmatter[existing])) target.frontmatter[existing] = value;
          continue;
        }
        target.frontmatter[key] = value;
        targetKeys.set(key.toLowerCase(), key);
        if (source.floatingKeys.includes(key) && !target.floatingKeys.includes(key)) target.floatingKeys.push(key);
        const shortcut = source.shortcuts?.[key];
        if (shortcut) (target.shortcuts ?? (target.shortcuts = {}))[key] = shortcut;
      }
    }
    function blockHasProperties(frontmatter) {
      return Object.keys(frontmatter ?? {}).some((key) => key !== "");
    }
    function mergeTypSubtyps(settings, source, target) {
      const sourceSubtyps = settings.typSubtyps?.[source];
      if (!sourceSubtyps) return;
      for (const [name, sourceData] of Object.entries(sourceSubtyps)) {
        const targetData = getSubtyp2(settings, target, name);
        if (targetData) {
          mergeBlockInto(targetData, sourceData);
        } else {
          ensureSubtyp(settings, target, name);
          settings.typSubtyps[target][name] = sourceData;
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
      mergeBlockInto(targetData, sourceData);
      deleteSubtyp(settings, typ, source);
    }
    async function renameSubtypInNotes(plugin, typ, oldKey, newValue) {
      let changed = 0;
      let skipped = 0;
      for (const file of plugin.typIndex.filesWithSubtyp(typ, oldKey)) {
        const { status } = await editFrontmatter(plugin.app, file, (doc) => {
          if (typKeyOf(propertyValue(doc.toObject(), SUBTYP_PROPERTY2)) !== oldKey) return;
          doc.set(SUBTYP_PROPERTY2, newValue);
        });
        if (status === "changed") changed++;
        else if (status === "skipped") skipped++;
      }
      return { changed, skipped };
    }
    module2.exports = {
      normalizeSubtypName,
      isEmptyValue,
      mergeBlockInto,
      blockHasProperties,
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

// src/typ-colors.js
var require_typ_colors = __commonJS({
  "src/typ-colors.js"(exports2, module2) {
    var { getLinkpath } = require("obsidian");
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
    function subtypRowColor(settings, typ, subtyp) {
      const { typList, typListSubtyp } = settings.colorViews;
      return typList && typListSubtyp ? subtypColor(settings, typ, subtyp) : null;
    }
    function appendSubtypPathPrefix(el, typText) {
      el.createSpan({ cls: "typ-subtyp-path-typ", text: typText });
      el.createSpan({ cls: "typ-subtyp-sep" });
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
    function colorForLink(plugin, linkEl, sourcePath, viewKey) {
      const href = linkEl.getAttribute("data-href");
      if (!href || linkEl.classList.contains("is-unresolved")) return null;
      const file = plugin.app.metadataCache.getFirstLinkpathDest(getLinkpath(href), sourcePath);
      return colorForFile(plugin, file, viewKey);
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
    function clearInlineColors2(root) {
      for (const el of root.querySelectorAll(`[${COLORED_ATTR}]`)) setInlineColor(el, null);
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
      colorForLink,
      nameColor,
      subtypRowColor,
      appendSubtypPathPrefix,
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
    var RenameModal = class extends ConfirmationModal {
      constructor(app, { title, value, preview, onSubmit }) {
        super(app);
        this.title = title;
        this.preview = preview;
        this.onSubmit = onSubmit;
        this.submitted = null;
        this.state = null;
        this.addClass("mod-file-rename");
        const inputEl = this.inputEl = createEl("textarea", { cls: "rename-textarea", attr: { rows: 1, spellcheck: "false" } });
        inputEl.value = value;
        inputEl.addEventListener("keypress", (event) => {
          if (event.key !== "Enter" || event.isComposing) return;
          event.preventDefault();
          if (this.state.ready) {
            this.submitted = inputEl.value;
            this.close();
          }
        });
        inputEl.addEventListener("input", () => {
          this.fitInput();
          this.update();
        });
        this.bodyEl = createDiv();
        this.addButton((button) => button.setButtonText("Cancel").setCancel());
        this.addButton((button) => {
          this.actionButton = button;
          button.setCta();
          button.onClick(() => {
            this.submitted = inputEl.value;
          });
        });
      }
      // One line that grows with a long name, as in Obsidian's dialog.
      fitInput() {
        this.inputEl.style.height = "auto";
        this.inputEl.style.height = `${this.inputEl.scrollHeight}px`;
      }
      update() {
        this.state = this.preview(this.inputEl.value);
        const { confirmText, warning = false, body = [], ready } = this.state;
        this.actionButton.setButtonText(confirmText).setDisabled(!ready);
        this.actionButton.buttonEl.toggleClass("mod-destructive", warning);
        this.bodyEl.empty();
        for (const paragraph of body) appendParts(this.bodyEl.createEl("p"), paragraph);
      }
      onOpen() {
        appendParts(this.titleEl, this.title);
        this.contentEl.append(this.inputEl, this.bodyEl);
        this.update();
        window.requestAnimationFrame(() => this.fitInput());
        this.inputEl.select();
        this.inputEl.focus();
      }
      onClose() {
        super.onClose();
        this.contentEl.empty();
        if (this.submitted !== null && this.preview(this.submitted).ready) this.onSubmit(this.submitted);
      }
    };
    module2.exports = { ConfirmModal, RenameModal, appendTypName, appendSubtypName, typNameNode, subtypNameNode };
  }
});

// src/frontmatter-sort.js
var require_frontmatter_sort = __commonJS({
  "src/frontmatter-sort.js"(exports2, module2) {
    var { Notice } = require("obsidian");
    var { getSubtyp: getSubtyp2 } = require_subtyps();
    var { typKeyOf, propertyValue, TYP_PROPERTY: TYP_PROPERTY2, SUBTYP_PROPERTY: SUBTYP_PROPERTY2 } = require_typ_index();
    var { plural } = require_typ_utils();
    var { ConfirmModal, typNameNode, subtypNameNode } = require_confirm_modal();
    var { editFrontmatter, skippedText } = require_frontmatter_text();
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
      if (!cacheNeedsSorting(app, file, globalOrder, typDefaultKeys)) return "unchanged";
      const { status } = await editFrontmatter(app, file, (doc) => {
        const existingKeys = doc.keys();
        if (existingKeys.length <= 1) return;
        const sortedKeys = computeSortedKeys(existingKeys, globalOrder, typDefaultKeys);
        if (!sortedKeys.every((key, i) => key === existingKeys[i])) doc.reorder(sortedKeys);
      });
      return status;
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
    function sortCandidates(app, plugin, onlyTyp, onlySubtyp = null) {
      const globalOrder = normalizeGlobalOrder2(plugin.settings.globalPropertyOrder);
      let checked = 0;
      const candidates = [];
      for (const file of app.vault.getMarkdownFiles()) {
        if (!plugin.settings.includeIgnoredFiles && app.metadataCache.isUserIgnored(file.path)) continue;
        const typ = plugin.typIndex.typOf(file);
        if (onlyTyp && typ !== onlyTyp) continue;
        const subtyp = plugin.typIndex.subtypOf(file);
        if (onlySubtyp && subtyp !== onlySubtyp) continue;
        const typDefaultKeys = orderedDefaultKeys(plugin, typ, subtyp);
        checked++;
        if (cacheNeedsSorting(app, file, globalOrder, typDefaultKeys)) candidates.push({ file, typDefaultKeys });
      }
      return { checked, candidates, globalOrder };
    }
    function sortScope(onlyTyp, onlySubtyp) {
      return onlySubtyp ? `${onlyTyp} / ${onlySubtyp}` : onlyTyp;
    }
    async function sortAllFrontmatter(app, plugin, onlyTyp, onlySubtyp = null) {
      const { checked, candidates, globalOrder } = sortCandidates(app, plugin, onlyTyp, onlySubtyp);
      const hasTypDefaults = onlyTyp ? orderedDefaultKeys(plugin, onlyTyp, onlySubtyp) !== null : null;
      const label = onlyTyp ? `Frontmatter sorting ${sortScope(onlyTyp, onlySubtyp)}` : "Frontmatter sorting";
      const progressText = (done) => `${label}: ${done} of ${plural(candidates.length, "note")}\u2026`;
      const notice = candidates.length >= LARGE_SORT_THRESHOLD ? new Notice(progressText(0), 0) : null;
      let changed = 0;
      let skipped = 0;
      try {
        for (const [index, { file, typDefaultKeys }] of candidates.entries()) {
          const status = await sortFileFrontmatter(app, file, globalOrder, typDefaultKeys);
          if (status === "changed") changed++;
          else if (status === "skipped") skipped++;
          if (notice && (index + 1) % PROGRESS_STEP === 0) notice.setMessage(progressText(index + 1));
        }
      } finally {
        notice?.hide();
      }
      return { checked, changed, skipped, hasTypDefaults };
    }
    function confirmLargeSort(plugin, onlyTyp, onlySubtyp, count, checked) {
      const noun = checked === 1 ? "note" : "notes";
      const typName = () => typNameNode(plugin, onlyTyp, plugin.settings.typColors[onlyTyp] ?? null);
      let title = `Re-sort ${count} of ${checked} ${noun}?`;
      if (onlySubtyp) {
        title = [`Re-sort ${count} of ${checked} `, subtypNameNode(plugin, onlyTyp, onlySubtyp), ` ${noun} of `, typName(), "?"];
      } else if (onlyTyp) {
        title = [`Re-sort ${count} of ${checked} `, typName(), ` ${noun}?`];
      }
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
    async function runFrontmatterSort(plugin, onlyTyp = null, onlySubtyp = null) {
      const { checked, candidates } = sortCandidates(plugin.app, plugin, onlyTyp, onlySubtyp);
      if (candidates.length >= LARGE_SORT_THRESHOLD && !await confirmLargeSort(plugin, onlyTyp, onlySubtyp, candidates.length, checked)) {
        return;
      }
      const { changed, skipped, hasTypDefaults, checked: checkedNow } = await sortAllFrontmatter(
        plugin.app,
        plugin,
        onlyTyp,
        onlySubtyp
      );
      const scope = sortScope(onlyTyp, onlySubtyp);
      let message = sortSummary(onlyTyp ? `Frontmatter sorting ${scope}` : "Frontmatter sorting", checkedNow, changed, skipped);
      if (hasTypDefaults === false) {
        message += ` Note: ${scope} has no TYP-Frontmatter, so only the global order was applied.`;
      }
      new Notice(message);
    }
    function sortSummary(label, checked, changed, skipped = 0) {
      const result = changed > 0 || skipped > 0 ? `${label}: checked ${plural(checked, "note")}, sorted ${changed}.` : `${label}: checked ${plural(checked, "note")}, all already sorted.`;
      return result + skippedText(skipped, "re-sorted");
    }
    module2.exports = {
      sortSingleFileFrontmatter,
      runFrontmatterSort,
      sortFrontmatterFor: sortFrontmatterFor2,
      placePropertyFor: placePropertyFor2,
      normalizeGlobalOrder: normalizeGlobalOrder2,
      computeSortedKeys,
      orderedDefaultKeys,
      DEFAULT_GLOBAL_ORDER,
      TYP_PROPERTY: TYP_PROPERTY2,
      SUBTYP_PROPERTY: SUBTYP_PROPERTY2
    };
  }
});

// src/pointer-drag.js
var require_pointer_drag = __commonJS({
  "src/pointer-drag.js"(exports2, module2) {
    var LONG_PRESS_MS = 250;
    var MOUSE_THRESHOLD = 4;
    var TOUCH_SLOP = 5;
    var SCROLL_ZONE = 40;
    var SCROLL_MAX_STEP = 12;
    function attachPointerDrag(el, options) {
      el.addEventListener("pointerdown", (event) => {
        if (!event.isPrimary) return;
        const isMouse = event.pointerType === "mouse";
        if (isMouse && event.button !== 0) return;
        if (options.canStart && !options.canStart(event)) return;
        runGesture(el, event, options);
      });
      el.addEventListener("touchstart", () => {
      }, { passive: false });
    }
    function runGesture(el, down, options) {
      const win = el.win ?? window;
      const isMouse = down.pointerType === "mouse";
      const immediate = !isMouse && options.immediateTouch === true;
      const threshold = isMouse ? MOUSE_THRESHOLD : TOUCH_SLOP;
      const startX = down.clientX;
      const startY = down.clientY;
      let armed = isMouse || immediate;
      let dragging = false;
      let lastEvent = down;
      let scrollEl = null;
      let scrollStep = 0;
      let frame = 0;
      let ownMenuEvent = null;
      const pressTimer = armed ? 0 : win.setTimeout(() => {
        armed = true;
        try {
          navigator.vibrate?.(50);
        } catch {
        }
      }, LONG_PRESS_MS);
      const autoScroll = () => {
        frame = 0;
        if (!dragging || scrollStep === 0 || !scrollEl) return;
        const before = scrollEl.scrollTop;
        scrollEl.scrollTop += scrollStep;
        if (scrollEl.scrollTop !== before) options.onMove?.(lastEvent);
        frame = win.requestAnimationFrame(autoScroll);
      };
      const updateScroll = (event) => {
        if (!scrollEl) return;
        const rect = scrollEl.getBoundingClientRect();
        const zone = Math.min(SCROLL_ZONE, rect.height / 4);
        let depth = 0;
        if (event.clientY < rect.top + zone) depth = (event.clientY - rect.top - zone) / zone;
        else if (event.clientY > rect.bottom - zone) depth = (event.clientY - rect.bottom + zone) / zone;
        scrollStep = Math.round(SCROLL_MAX_STEP * Math.max(-1, Math.min(1, depth)));
        if (scrollStep !== 0 && !frame) frame = win.requestAnimationFrame(autoScroll);
      };
      const onMove = (event) => {
        if (event.pointerId !== down.pointerId) return;
        lastEvent = event;
        if (!dragging) {
          const dx = event.clientX - startX;
          const dy = event.clientY - startY;
          const moved = dx * dx + dy * dy >= threshold * threshold;
          if (!armed) {
            if (moved) finish();
            return;
          }
          if (!moved) return;
          dragging = true;
          win.getSelection()?.removeAllRanges();
          scrollEl = options.scrollEl ?? scrollParent(el);
          options.onStart?.(down);
        }
        event.preventDefault();
        options.onMove?.(event);
        updateScroll(event);
      };
      const onUp = (event) => {
        if (event.pointerId !== down.pointerId) return;
        if (dragging) {
          finish();
          options.onEnd?.(true);
          swallowNextClick(win);
        } else if (armed && !isMouse && !immediate) {
          finish();
          swallowNextClick(win);
          if (options.longPressMenu) {
            ownMenuEvent = new win.MouseEvent("contextmenu", {
              bubbles: true,
              cancelable: true,
              button: 2,
              clientX: startX,
              clientY: startY,
              screenX: down.screenX,
              screenY: down.screenY
            });
            down.target.dispatchEvent(ownMenuEvent);
          }
        } else {
          finish();
        }
      };
      const onCancel = (event) => {
        if (event.pointerId !== down.pointerId) return;
        const wasDragging = dragging;
        finish();
        if (wasDragging) options.onEnd?.(false);
      };
      const onKey = (event) => {
        if (event.key !== "Escape" || !dragging) return;
        event.preventDefault();
        event.stopPropagation();
        finish();
        options.onEnd?.(false);
      };
      const onTouchMove = (event) => {
        if (armed && event.cancelable) event.preventDefault();
      };
      const onContextMenu = (event) => {
        if (event === ownMenuEvent) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      };
      function finish() {
        dragging = false;
        win.clearTimeout(pressTimer);
        if (frame) win.cancelAnimationFrame(frame);
        frame = 0;
        win.removeEventListener("pointermove", onMove, true);
        win.removeEventListener("pointerup", onUp, true);
        win.removeEventListener("pointercancel", onCancel, true);
        win.removeEventListener("keydown", onKey, true);
        win.removeEventListener("touchmove", onTouchMove);
        if (!isMouse) win.setTimeout(() => win.removeEventListener("contextmenu", onContextMenu, true), 0);
      }
      win.addEventListener("pointermove", onMove, true);
      win.addEventListener("pointerup", onUp, true);
      win.addEventListener("pointercancel", onCancel, true);
      win.addEventListener("keydown", onKey, true);
      if (!isMouse) {
        win.addEventListener("touchmove", onTouchMove, { passive: false });
        win.addEventListener("contextmenu", onContextMenu, true);
      }
    }
    function swallowNextClick(win) {
      const swallow = (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        off();
      };
      const off = () => {
        win.removeEventListener("click", swallow, true);
        win.clearTimeout(timer);
      };
      const timer = win.setTimeout(off, 400);
      win.addEventListener("click", swallow, true);
    }
    function scrollParent(el) {
      for (let node = el.parentElement; node; node = node.parentElement) {
        if (node.scrollHeight <= node.clientHeight) continue;
        if (/(auto|scroll)/.test(node.win.getComputedStyle(node).overflowY)) return node;
      }
      return null;
    }
    function gapIndexAt(rows, clientY) {
      const index = rows.findIndex((row) => {
        const rect = row.getBoundingClientRect();
        return clientY < rect.top + rect.height / 2;
      });
      return index === -1 ? rows.length : index;
    }
    function showDropGap(rows, gap) {
      for (const row of rows) row.removeClass("is-drop-before", "is-drop-after");
      if (gap === null || rows.length === 0) return;
      if (gap < rows.length) rows[gap].addClass("is-drop-before");
      else rows[rows.length - 1].addClass("is-drop-after");
    }
    module2.exports = { attachPointerDrag, gapIndexAt, showDropGap };
  }
});

// src/frontmatter-order-editor.js
var require_frontmatter_order_editor = __commonJS({
  "src/frontmatter-order-editor.js"(exports2, module2) {
    var { setIcon, Notice } = require("obsidian");
    var { TYP_PROPERTY: TYP_PROPERTY2, SUBTYP_PROPERTY: SUBTYP_PROPERTY2, runFrontmatterSort } = require_frontmatter_sort();
    var { attachPointerDrag, gapIndexAt, showDropGap } = require_pointer_drag();
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
      let rows = [];
      let gap = null;
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
          attachPointerDrag(row, {
            canStart: (event) => event.pointerType === "mouse" ? !event.target.closest("input, .typ-order-remove") : !!event.target.closest(".typ-order-drag"),
            immediateTouch: true,
            onStart: () => {
              rows = [...listEl.children].filter((el) => el.typOrderIndex !== void 0);
              gap = null;
              row.addClass("is-dragging");
            },
            onMove: (event) => {
              gap = gapIndexAt(rows, event.clientY);
              showDropGap(rows, gap === index || gap === index + 1 ? null : gap);
            },
            onEnd: async (commit) => {
              row.removeClass("is-dragging");
              showDropGap(rows, null);
              if (!commit || gap === null || gap === index || gap === index + 1) return;
              const insertBefore = index < gap ? gap - 1 : gap;
              const [moved] = order().splice(index, 1);
              order().splice(insertBefore, 0, moved);
              await plugin.saveSettings();
              render();
            }
          });
          row.typOrderIndex = index;
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
      // How the TYP-List shows the Subtyps: "subtyps" (in brackets), "rows" or
      // "none". Switched by the header button next to sorting (SECONDARY_MODES in
      // typ-pane.js), not here. Also picks the picker flow: "rows" = one picker
      // with "TYP / Subtyp" rows, otherwise TYP-Picker and Subtyp-Picker in turn
      // (see pickTypAndSubtyp in typ-picker.js).
      typListSecondary: "subtyps",
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
        outgoingLinks: true,
        bookmarks: true,
        // Bases: file names; the two sub-rows below it color links in values and
        // group headings (see bases-colors.js).
        bases: true,
        basesLinks: true,
        basesGroupHeadings: true,
        // "<view>Subtyp" sub-toggles: use a note's Subtyp color instead of its
        // TYP's (see colorForFile in typ-colors.js).
        fileExplorerSubtyp: true,
        graphSubtyp: true,
        searchSubtyp: true,
        recentFilesSubtyp: true,
        backlinksSubtyp: true,
        outgoingLinksSubtyp: true,
        bookmarksSubtyp: true,
        basesSubtyp: true,
        basesLinksSubtyp: true,
        basesGroupHeadingsSubtyp: true,
        linksSubtyp: true,
        propertyLinksSubtyp: true,
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
        // Tab headers (and the mobile tab switcher) and the view header above a
        // note: note name and breadcrumb folders with a folder note (see
        // header-colors.js).
        tabTitles: true,
        tabTitlesSubtyp: true,
        viewHeader: true,
        viewHeaderSubtyp: true,
        links: true,
        // Links in property values (see property-link-colors.js).
        propertyLinks: true,
        // Suggestion lists (see suggest-colors.js): the quick switcher, "[[" in
        // the editor and in property fields, Canvas "Add note from vault" and Note
        // Composer.
        quickSwitcher: true,
        quickSwitcherSubtyp: true,
        linkSuggestions: true,
        linkSuggestionsSubtyp: true,
        fileDialogs: true,
        fileDialogsSubtyp: true
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
        );
        const colorViewToggle = (group, key, name, desc, subtypKey = null, { typTooltip = "Color by TYP", subtypTooltip = "Use Subtyp color instead of TYP color", nested = false } = {}) => group.addSetting((setting) => {
          setting.setName(name).setDesc(desc);
          if (nested) setting.settingEl.addClass("typ-nested-setting");
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
        const coloringGroup = new SettingGroup(containerEl).setHeading("Coloring");
        colorViewToggle(
          coloringGroup,
          "typList",
          "TYP-Pane and -Picker",
          `Color TYP and Subtyp names in the TYP-Pane, the TYP-Picker and the plugin's dialogs. Rows "TYP / Subtyp" are only colored with Subtyp on.`,
          "typListSubtyp"
        );
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
        colorViewToggle(coloringGroup, "fileExplorer", "File explorer", "Color note names in the file explorer.", "fileExplorerSubtyp");
        colorViewToggle(coloringGroup, "graph", "Graph", "Color nodes in the global and local graph.", "graphSubtyp");
        colorViewToggle(coloringGroup, "search", "Search", "Color result titles in search and in query blocks in notes.", "searchSubtyp");
        colorViewToggle(coloringGroup, "bookmarks", "Bookmarks", "Color bookmarks that point directly to a note.", "bookmarksSubtyp");
        colorViewToggle(
          coloringGroup,
          "allProperties",
          "All Properties",
          `In Obsidian's "All properties" view, color property names that belong to exactly one TYP-Frontmatter, or bold them if more than one TYP uses them. With Subtyp, Subtyp blocks count as well, in the Subtyp color.`,
          "allPropertiesSubtyp",
          { typTooltip: "TYP-Frontmatter", subtypTooltip: "Include Subtyp blocks, in Subtyp color" }
        );
        colorViewToggle(
          coloringGroup,
          "quickSwitcher",
          "Quick switcher",
          "Color notes, aliases and bookmarks to a note in the quick switcher.",
          "quickSwitcherSubtyp"
        );
        colorViewToggle(
          coloringGroup,
          "backlinks",
          "Backlinks",
          "Color results in the backlinks pane and in embedded backlinks, including unlinked mentions.",
          "backlinksSubtyp"
        );
        colorViewToggle(
          coloringGroup,
          "outgoingLinks",
          "Outgoing links",
          "Color links in the outgoing links pane and the notes named in its unlinked mentions.",
          "outgoingLinksSubtyp"
        );
        colorViewToggle(
          coloringGroup,
          "bases",
          "Bases",
          "Color note names in Bases (table, cards, list), in .base files and embedded in notes.",
          "basesSubtyp"
        );
        if (this.plugin.settings.colorViews.bases) {
          colorViewToggle(
            coloringGroup,
            "basesLinks",
            "Bases links",
            "Color links in values: link properties, file.links, backlinks, embeds and formulas.",
            "basesLinksSubtyp",
            { nested: true }
          );
          colorViewToggle(
            coloringGroup,
            "basesGroupHeadings",
            "Bases group headings",
            "Color group headings that link to a note.",
            "basesGroupHeadingsSubtyp",
            { nested: true }
          );
        }
        colorViewToggle(
          coloringGroup,
          "tabTitles",
          "Tab titles",
          "Color note names in tab headers, stacked tabs included, and in the mobile tab switcher.",
          "tabTitlesSubtyp"
        );
        colorViewToggle(
          coloringGroup,
          "links",
          "Links in notes",
          "Color internal links by the TYP of their target (reading view, Live Preview, hover preview). Unresolved links stay as they are.",
          "linksSubtyp"
        );
        colorViewToggle(
          coloringGroup,
          "propertyLinks",
          "Property links",
          "Color internal links in property values by the TYP of their target (property block, properties sidebar, hover preview, TYP-Pane). External links and links to notes that don't exist stay as they are.",
          "propertyLinksSubtyp"
        );
        colorViewToggle(
          coloringGroup,
          "linkSuggestions",
          "Link suggestions",
          "Color notes and aliases in link suggestions, after [[ in notes and in property fields. Headings, blocks and notes that don't exist stay as they are.",
          "linkSuggestionsSubtyp"
        );
        colorViewToggle(
          coloringGroup,
          "viewHeader",
          "Header (Breadcrumbs)",
          "Color the note name and every folder that has a folder note in the header above a note or base.",
          "viewHeaderSubtyp"
        );
        colorViewToggle(
          coloringGroup,
          "fileDialogs",
          "Core file dialogs",
          'Color notes, aliases and bookmarks to a note in Canvas "Add note from vault" and in Note Composer.',
          "fileDialogsSubtyp"
        );
        colorViewToggle(coloringGroup, "recentFiles", "Recent Files", "Color entries in the Recent Files plugin.", "recentFilesSubtyp");
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
      const choice = await plugin.pickTypAndSubtyp({ includeManualOff: true, allNotes: true });
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
        const choice = await plugin.pickTypAndSubtyp({ includeManualOff: true, allNotes: true });
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

// src/set-typ.js
var require_set_typ = __commonJS({
  "src/set-typ.js"(exports2, module2) {
    var { Notice } = require("obsidian");
    var { editFrontmatter, editFrontmatterText } = require_frontmatter_text();
    var { normalizeGlobalOrder: normalizeGlobalOrder2, computeSortedKeys, orderedDefaultKeys } = require_frontmatter_sort();
    var { typKeyOf, TYP_PROPERTY: TYP_PROPERTY2, SUBTYP_PROPERTY: SUBTYP_PROPERTY2 } = require_typ_index();
    var hasValue = (value) => value !== void 0 && value !== null && value !== "";
    var isPatch = (value) => value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
    function valueOf(object, name) {
      if (!object) return void 0;
      if (Object.prototype.hasOwnProperty.call(object, name)) return object[name];
      const lower = name.toLowerCase();
      const key = Object.keys(object).find((k) => k.toLowerCase() === lower);
      return key === void 0 ? void 0 : object[key];
    }
    var RUN_MODE_DYNAMIC_PROCESSOR = 4;
    var FUNCTIONS_MODE_USER_INTERNAL = 1;
    function templaterOf(app) {
      const templater = app.plugins?.plugins?.["templater-obsidian"]?.templater;
      const usable = typeof templater?.create_running_config === "function" && typeof templater?.functions_generator?.generate_object === "function" && typeof templater?.start_templater_task === "function" && typeof templater?.end_templater_task === "function";
      return usable ? templater : null;
    }
    async function openTemplaterRun(app, file) {
      const templater = templaterOf(app);
      if (!templater) return null;
      templater.start_templater_task(file.path);
      const end = async () => {
        try {
          await templater.end_templater_task(file.path);
        } catch (error) {
          console.error("TYP-System: couldn't end the Templater run", error);
        }
      };
      try {
        const config = templater.create_running_config(file, file, RUN_MODE_DYNAMIC_PROCESSOR);
        const tp = await templater.functions_generator.generate_object(config, FUNCTIONS_MODE_USER_INTERNAL);
        if (tp && typeof tp.user === "object") return { tp, end };
      } catch (error) {
        console.error("TYP-System: couldn't create Templater's tp object", error);
      }
      await end();
      return null;
    }
    async function resolveScriptShortcuts(plugin, file, { typ, subtyp, values, allowedKeys, existing }) {
      const { app } = plugin;
      const shortcuts = plugin.getTypShortcuts(typ, { subtyp });
      const afterActions = [];
      const withoutTemplater = [];
      let run;
      for (const [key, shortcut] of Object.entries(shortcuts)) {
        const name = shortcut.name;
        if (hasValue(valueOf(existing, key))) {
          values[key] = null;
          continue;
        }
        if (hasValue(values[key])) continue;
        if (run === void 0) run = await openTemplaterRun(app, file);
        if (!run) {
          withoutTemplater.push(key);
          values[key] = shortcut.fallback ?? null;
          continue;
        }
        const script = run.tp.user[name];
        let result = null;
        let failed = false;
        if (typeof script !== "function") {
          failed = true;
          new Notice(`Templater script "${name}" (property "${key}") not found \u2013 fallback value used.`);
        } else {
          try {
            const after = (fn) => afterActions.push({ name, fn });
            const ctx = { typ, subtyp, key, values, after, args: shortcut.args };
            const args = plugin.resolveShortcutArgs(shortcut.params, shortcut.args, { newFile: file, ctx, key });
            result = await script(run.tp, ...args);
          } catch (error) {
            failed = true;
            console.error(`TYP-System: Templater script "${name}" failed`, error);
            new Notice(`Templater script "${name}" (property "${key}") failed: ${error?.message ?? error} \u2013 fallback value used.`);
          }
        }
        if (failed) {
          values[key] = shortcut.fallback ?? null;
          continue;
        }
        if (isPatch(result)) {
          values[key] = result[key] ?? null;
          for (const [patchKey, patchValue] of Object.entries(result)) {
            if (patchKey === key || !allowedKeys.has(patchKey) || !hasValue(patchValue)) continue;
            if (!hasValue(values[patchKey])) values[patchKey] = patchValue;
          }
        } else {
          values[key] = result ?? null;
        }
      }
      if (withoutTemplater.length > 0) {
        new Notice(`Script shortcuts need Templater \u2013 fallback values used for: ${withoutTemplater.join(", ")}.`);
      }
      return { afterActions, run: run ?? null };
    }
    function blockKeys(plugin, typ, subtyp) {
      if (!typ) return /* @__PURE__ */ new Set();
      const { defaults } = plugin.collectBlocks(typ, subtyp, true);
      return new Set(Object.keys(defaults).map((key) => key.toLowerCase()));
    }
    function applyTyp(plugin, doc, { typ, subtyp, values, globalOrder }) {
      const previousTyp = typKeyOf(doc.get(doc.findKey(TYP_PROPERTY2) ?? TYP_PROPERTY2));
      const previousSubtyp = typKeyOf(doc.get(doc.findKey(SUBTYP_PROPERTY2) ?? SUBTYP_PROPERTY2));
      doc.set(TYP_PROPERTY2, typ);
      if (subtyp) doc.set(SUBTYP_PROPERTY2, subtyp);
      else doc.delete(SUBTYP_PROPERTY2);
      for (const [key, value] of Object.entries(values)) {
        const actual = doc.findKey(key);
        if (actual === void 0) doc.set(key, value);
        else if (!hasValue(doc.get(actual)) && hasValue(value)) doc.set(actual, value);
      }
      const newKeys = blockKeys(plugin, typ, subtyp);
      const isSystemKey = (key) => [TYP_PROPERTY2, SUBTYP_PROPERTY2].some((name) => name.toLowerCase() === key);
      for (const key of blockKeys(plugin, previousTyp, previousSubtyp)) {
        if (newKeys.has(key) || isSystemKey(key)) continue;
        const actual = doc.findKey(key);
        if (actual !== void 0 && !hasValue(doc.get(actual))) doc.delete(actual);
      }
      const keys = doc.keys();
      const sorted = computeSortedKeys(keys, globalOrder, orderedDefaultKeys(plugin, typ, subtyp));
      if (!sorted.every((key, i) => key === keys[i])) doc.reorder(sorted);
    }
    async function setTypOfFile(plugin, file, { typ, subtyp = null }) {
      const { app } = plugin;
      const values = plugin.getTypDefaults(typ, { file, subtyp });
      const allowedKeys = new Set(Object.keys(plugin.getTypDefaults(typ, { includeFloating: true, file, subtyp })));
      const existing = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
      const { afterActions, run } = await resolveScriptShortcuts(plugin, file, { typ, subtyp, values, allowedKeys, existing });
      try {
        const globalOrder = normalizeGlobalOrder2(plugin.settings.globalPropertyOrder);
        const { status } = await editFrontmatter(app, file, (doc) => applyTyp(plugin, doc, { typ, subtyp, values, globalOrder }));
        if (status === "skipped") return status;
        for (const { name, fn } of afterActions) {
          try {
            await fn();
          } catch (error) {
            console.error(`TYP-System: after-action of Templater script "${name}" failed`, error);
            new Notice(`After-action of Templater script "${name}" failed: ${error?.message ?? error}`);
          }
        }
        return status;
      } finally {
        await run?.end();
      }
    }
    var typLabel = (typ, subtyp) => subtyp ? `${typ} / ${subtyp}` : typ;
    async function setTypOfActiveNote(plugin, file) {
      const choice = await plugin.pickTypAndSubtyp({ includeManualOff: false });
      if (!choice) return;
      const status = await setTypOfFile(plugin, file, choice);
      if (status === "skipped") {
        new Notice(`TYP of "${file.basename}" couldn't be set without losing comments in its frontmatter.`);
      } else {
        new Notice(`TYP of "${file.basename}" set to ${typLabel(choice.typ, choice.subtyp)}.`);
      }
    }
    async function createUntitledNote(app, folder, content) {
      if (typeof app.fileManager.createNewMarkdownFile === "function") {
        return app.fileManager.createNewMarkdownFile(folder, void 0, content);
      }
      const prefix = folder.isRoot() ? "" : folder.path + "/";
      let path = `${prefix}Untitled.md`;
      for (let i = 1; app.vault.getAbstractFileByPath(path); i++) path = `${prefix}Untitled ${i}.md`;
      return app.vault.create(path, content);
    }
    async function createNoteWithTyp(plugin) {
      const choice = await plugin.pickTypAndSubtyp({ includeManualOff: false });
      if (!choice) return;
      const { app } = plugin;
      const folder = app.fileManager.getNewFileParent(app.workspace.getActiveFile()?.path ?? "");
      const initial = editFrontmatterText("", (doc) => {
        doc.set(TYP_PROPERTY2, choice.typ);
        if (choice.subtyp) doc.set(SUBTYP_PROPERTY2, choice.subtyp);
      }).content;
      const file = await createUntitledNote(app, folder, initial);
      try {
        await setTypOfFile(plugin, file, choice);
      } finally {
        await app.workspace.getLeaf("tab").openFile(file, { active: true, state: { mode: "source" }, eState: { rename: "all" } });
      }
    }
    module2.exports = { setTypOfFile, setTypOfActiveNote, createNoteWithTyp };
  }
});

// src/commands.js
var require_commands = __commonJS({
  "src/commands.js"(exports2, module2) {
    var { Notice } = require("obsidian");
    var { runFrontmatterSort, sortSingleFileFrontmatter } = require_frontmatter_sort();
    var { isBasesEnabled, createBaseCommand, activeBaseView, updateActiveView } = require_bases();
    var { setTypOfActiveNote, createNoteWithTyp } = require_set_typ();
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
        id: "set-typ-of-active-note",
        name: "Set TYP of active note",
        checkCallback: (checking) => {
          const file = plugin.app.workspace.getActiveFile();
          if (!file || file.extension !== "md") return false;
          if (checking) return true;
          runOrReportError("Set TYP", () => setTypOfActiveNote(plugin, file))();
          return true;
        }
      });
      plugin.addCommand({
        id: "new-note-with-typ",
        name: "New note with TYP",
        callback: runOrReportError("New note with TYP", () => createNoteWithTyp(plugin))
      });
      plugin.addCommand({
        id: "sort-frontmatter-all",
        name: "Sort frontmatter in all notes",
        // Asks first when the run is large, see runFrontmatterSort.
        callback: runOrReportError("Frontmatter sorting", () => runFrontmatterSort(plugin, null))
      });
      plugin.addCommand({
        id: "sort-frontmatter-typ",
        name: "Sort frontmatter for one TYP or Subtyp",
        // The id stays from the time it only took a TYP, so hotkeys keep working.
        callback: runOrReportError("Frontmatter sorting", async () => {
          const choice = await plugin.pickTypAndSubtyp({ includeManualOff: true, includeUnregistered: true, allNotes: true });
          if (!choice) return;
          await runFrontmatterSort(plugin, choice.typ, choice.subtyp);
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
            const status = await sortSingleFileFrontmatter(plugin.app, plugin, file);
            const messages = {
              changed: `Sorted frontmatter of "${file.basename}".`,
              unchanged: `Frontmatter of "${file.basename}" was already sorted.`,
              skipped: `Frontmatter of "${file.basename}" couldn't be sorted without losing comments.`
            };
            new Notice(messages[status]);
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
      current = { token, revision: plugin.settingsRevision ?? 0, snapshot, message };
      const fragment = createFragment((f) => {
        f.appendText(message);
        const button = f.createEl("button", { cls: "typ-notice-button", text: "Undo" });
        button.addEventListener("click", () => undo(plugin, token));
      });
      new Notice(fragment, UNDO_NOTICE_DURATION);
    }
    async function undo(plugin, token) {
      if (current?.token !== token || (plugin.settingsRevision ?? 0) !== current.revision) {
        new Notice("Can't undo \u2013 the settings have changed since.");
        return false;
      }
      const { snapshot } = current;
      current = null;
      for (const key of Object.keys(plugin.settings)) delete plugin.settings[key];
      Object.assign(plugin.settings, snapshot);
      await plugin.saveSettings();
      plugin.refreshTypColors?.();
      return true;
    }
    async function undoLast(plugin) {
      if (!current) {
        new Notice("Nothing to undo.");
        return;
      }
      const { token, message } = current;
      if (await undo(plugin, token)) new Notice(`Undone: ${message}`);
    }
    function registerUndoCommand(plugin) {
      plugin.addCommand({
        id: "undo-last-action",
        name: "Undo last TYP-Pane action",
        callback: () => undoLast(plugin)
      });
    }
    module2.exports = { snapshotSettings, offerUndo, registerUndoCommand };
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

// src/property-rename-notes.js
var require_property_rename_notes = __commonJS({
  "src/property-rename-notes.js"(exports2, module2) {
    var { Notice } = require("obsidian");
    var { ConfirmModal, typNameNode, subtypNameNode } = require_confirm_modal();
    var { editFrontmatter, skippedText } = require_frontmatter_text();
    var { orderedDefaultKeys } = require_frontmatter_sort();
    var { plural } = require_typ_utils();
    var OFFER_NOTICE_DURATION = 15e3;
    var lower = (key) => key.toLowerCase();
    function holdsOldKey(frontmatter, oldKey, newKey) {
      return Object.keys(frontmatter ?? {}).some((key) => lower(key) === lower(oldKey) && key !== newKey);
    }
    function followsRename(plugin, typ, subtyp, oldKey, newKey) {
      const keys = orderedDefaultKeys(plugin, typ, subtyp) ?? [];
      if (!keys.includes(newKey)) return false;
      return lower(oldKey) === lower(newKey) || !keys.some((key) => lower(key) === lower(oldKey));
    }
    function surveyNotes(plugin, { typ, subtyp }, oldKey, newKey) {
      const { app, typIndex } = plugin;
      const holds = (file) => holdsOldKey(app.metadataCache.getFileCache(file)?.frontmatter, oldKey, newKey);
      const blockFiles = subtyp === null ? typIndex.filesWithTyp(typ) : typIndex.filesWithSubtyp(typ, subtyp);
      const follows = /* @__PURE__ */ new Map();
      const files = [];
      let kept = 0;
      for (const file of blockFiles) {
        if (!holds(file)) continue;
        const noteSubtyp = typIndex.subtypOf(file);
        if (!follows.has(noteSubtyp)) follows.set(noteSubtyp, followsRename(plugin, typ, noteSubtyp, oldKey, newKey));
        if (follows.get(noteSubtyp)) files.push(file);
        else kept++;
      }
      const blockPaths = new Set(blockFiles.map((file) => file.path));
      const includeIgnored = !!plugin.settings.includeIgnoredFiles;
      let others = 0;
      for (const file of app.vault.getMarkdownFiles()) {
        if (blockPaths.has(file.path)) continue;
        if (!includeIgnored && app.metadataCache.isUserIgnored(file.path)) continue;
        if (holds(file)) others++;
      }
      return { files, kept, others };
    }
    function offerRenameInNotes(plugin, store, oldKey, newKey) {
      const { files } = surveyNotes(plugin, store, oldKey, newKey);
      if (files.length === 0) return;
      const fragment = createFragment((f) => {
        f.appendText(
          `"${oldKey}" renamed to "${newKey}" in ${store.subtyp ?? store.typ}. ${plural(files.length, "note")} still ${files.length === 1 ? "has" : "have"} the old name.`
        );
        const button = f.createEl("button", { cls: "typ-notice-button", text: "Update notes" });
        button.addEventListener("click", () => confirmRenameInNotes(plugin, store, oldKey, newKey));
      });
      new Notice(fragment, OFFER_NOTICE_DURATION);
    }
    function confirmRenameInNotes(plugin, store, oldKey, newKey) {
      const { files, kept, others } = surveyNotes(plugin, store, oldKey, newKey);
      if (files.length === 0) {
        new Notice(`No note left to rename "${oldKey}" to "${newKey}" in.`);
        return;
      }
      const { typ, subtyp } = store;
      const typName = typNameNode(plugin, typ, plugin.settings.typColors[typ] ?? null);
      const noun = files.length === 1 ? "note" : "notes";
      const question = `Rename "${oldKey}" to "${newKey}" in ${files.length} `;
      const title = subtyp === null ? [question, typName, ` ${noun}?`] : [question, subtypNameNode(plugin, typ, subtyp), ` ${noun} of `, typName, "?"];
      const body = [];
      if (kept > 0) {
        body.push(`${plural(kept, "note")} ${kept === 1 ? "keeps" : "keep"} "${oldKey}": another block of ${typ} still has it.`);
      }
      if (others > 0) {
        body.push(
          `${plural(others, "other note")} with "${oldKey}" ${others === 1 ? "stays" : "stay"} as ${others === 1 ? "it is" : "they are"}. "All properties" renames it in every note.`
        );
      }
      new ConfirmModal(plugin.app, {
        title,
        body,
        confirmText: "Update notes",
        onConfirm: () => renameInNotes(plugin, files, oldKey, newKey)
      }).open();
    }
    async function renameInNotes(plugin, files, oldKey, newKey) {
      let changed = 0;
      let skipped = 0;
      let conflicts = 0;
      try {
        for (const file of files) {
          let conflict = false;
          const { status } = await editFrontmatter(plugin.app, file, (doc) => {
            conflict = !doc.rename(oldKey, newKey);
          });
          if (conflict) conflicts++;
          else if (status === "changed") changed++;
          else if (status === "skipped") skipped++;
        }
      } catch (error) {
        console.error("TYP-System: property rename in notes failed", error);
        new Notice(`Renaming "${oldKey}" in notes failed after ${plural(changed, "note")}: ${error.message}`);
        return;
      }
      const conflictText = conflicts ? ` ${plural(conflicts, "note")} skipped ("${oldKey}" and "${newKey}" hold different values).` : "";
      new Notice(`"${oldKey}" \u2192 "${newKey}": ${plural(changed, "note")} updated.${skippedText(skipped, "updated")}${conflictText}`);
    }
    module2.exports = { offerRenameInNotes };
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
    var { offerRenameInNotes } = require_property_rename_notes();
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
          const isRename = removedKeys.length === 1 && addedKeys.length === 1;
          let floating = store.getFloating();
          if (isRename) {
            floating = floating.map((key) => key === removedKeys[0] ? addedKeys[0] : key);
          } else if (removedKeys.length > 0) {
            floating = floating.filter((key) => !removedKeys.includes(key));
          }
          const shortcuts = { ...store.getShortcuts() };
          if (isRename) {
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
          if (isRename) offerRenameInNotes(view.plugin, store, removedKeys[0], addedKeys[0]);
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
    var { attachPointerDrag } = require_pointer_drag();
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
        // (see addBlankProperty).
        addBlank(section) {
          const editor = editors.get(section);
          if (editor) addBlankProperty(editor);
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
        attachBlockDrag(blockEl, section);
      }
      function attachBlockDrag(blockEl, section) {
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
        attachPointerDrag(blockEl, {
          canStart: (event) => isGrabTarget(event.target),
          longPressMenu: true,
          onStart: () => {
            targetIndex = null;
            wrapper.doc.body.addClass("typ-block-dragging");
            blockEl.addClass("is-dragging");
            measure();
            indicator = wrapper.createDiv({ cls: "typ-block-drop-indicator" });
          },
          onMove: (event) => {
            const y = event.clientY - wrapper.getBoundingClientRect().top;
            targetIndex = Math.max(1, boxes.filter((box) => (box.top + box.bottom) / 2 < y).length);
            const from = boxes.findIndex((box) => box.section === section);
            indicator.toggle(targetIndex !== from && targetIndex !== from + 1);
            const halfGap = 6;
            const gapY = targetIndex === boxes.length ? boxes[boxes.length - 1].bottom + halfGap : (boxes[targetIndex - 1].bottom + boxes[targetIndex].top) / 2;
            indicator.style.top = `${gapY - 1}px`;
          },
          onEnd: (commit) => {
            wrapper.doc.body.removeClass("typ-block-dragging");
            blockEl.removeClass("is-dragging");
            indicator?.remove();
            indicator = null;
            const order = boxes.map((box) => box.section);
            const from = order.indexOf(section);
            if (!commit || targetIndex === null || targetIndex === from || targetIndex === from + 1) return;
            order.splice(from, 1);
            order.splice(from < targetIndex ? targetIndex - 1 : targetIndex, 0, section);
            onMoveSection?.(order);
          }
        });
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
          "pointerdown",
          (event) => {
            if (!event.isPrimary || event.button !== 0) return;
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
          if (!drag || !wrapper.doc.body.hasClass("is-grabbing")) return;
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
        wrapper.win.addEventListener("pointermove", onWinMove, true);
        wrapper.win.addEventListener("pointerup", onWinUp, true);
        wrapper.win.addEventListener("pointercancel", onWinUp, true);
        anchor.register(() => {
          wrapper.win.removeEventListener("pointermove", onWinMove, true);
          wrapper.win.removeEventListener("pointerup", onWinUp, true);
          wrapper.win.removeEventListener("pointercancel", onWinUp, true);
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
    var { moveTypSubtyps, deleteTypSubtyps, mergeTypSubtyps, mergeBlockInto, blockHasProperties, getSubtypNames: getSubtypNames2 } = require_subtyps();
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
    function mergeTypSettings(settings, source, target) {
      for (const table of ["typDefaultFrontmatter", "typFloatingKeys", "typShortcuts"]) settings[table] ?? (settings[table] = {});
      const merged = {
        frontmatter: settings.typDefaultFrontmatter[target] ?? {},
        floatingKeys: settings.typFloatingKeys[target] ?? [],
        shortcuts: settings.typShortcuts[target] ?? {}
      };
      mergeBlockInto(merged, {
        frontmatter: settings.typDefaultFrontmatter[source] ?? {},
        floatingKeys: settings.typFloatingKeys[source] ?? [],
        shortcuts: settings.typShortcuts[source] ?? {}
      });
      if (Object.keys(merged.frontmatter).length > 0) settings.typDefaultFrontmatter[target] = merged.frontmatter;
      if (merged.floatingKeys.length > 0) settings.typFloatingKeys[target] = merged.floatingKeys;
      if (Object.keys(merged.shortcuts).length > 0) settings.typShortcuts[target] = merged.shortcuts;
      mergeTypSubtyps(settings, source, target);
      deleteTypSettings(settings, source);
    }
    function typHasMergeableSettings(settings, typ) {
      return blockHasProperties(settings.typDefaultFrontmatter?.[typ]) || getSubtypNames2(settings, typ).length > 0;
    }
    module2.exports = { TYP_SETTING_TABLES, moveTypSettings, deleteTypSettings, mergeTypSettings, typHasMergeableSettings };
  }
});

// src/typ-pane.js
var require_typ_pane = __commonJS({
  "src/typ-pane.js"(exports2, module2) {
    var { ItemView, Menu, Notice, setIcon, debounce } = require("obsidian");
    var { ConfirmModal, RenameModal, typNameNode, subtypNameNode } = require_confirm_modal();
    var { snapshotSettings, offerUndo, registerUndoCommand } = require_undo();
    var { mountFrontmatterBlocks } = require_frontmatter_blocks();
    var { renderShortcutControls } = require_typ_frontmatter_editor();
    var { moveTypSettings, deleteTypSettings, mergeTypSettings, typHasMergeableSettings } = require_typ_settings();
    var { runOrReportError } = require_commands();
    var { isBasesEnabled, createBaseFor } = require_bases();
    var { runFrontmatterSort } = require_frontmatter_sort();
    var { attachPointerDrag, gapIndexAt, showDropGap } = require_pointer_drag();
    var { editFrontmatter, skippedText } = require_frontmatter_text();
    var {
      normalizeSubtypName,
      getSubtypNames: getSubtypNames2,
      ensureSubtyp,
      blockHasProperties,
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
    var { typKeyOf, propertyValue, TYP_PROPERTY: TYP_PROPERTY2, SUBTYP_PROPERTY: SUBTYP_PROPERTY2 } = require_typ_index();
    var {
      subtypColor,
      applyColorOffset,
      hasColorOffset,
      subtypHasOwnColor,
      paintColorDot,
      nameColor,
      subtypRowColor,
      appendSubtypPathPrefix,
      channelBounds,
      clampedOffset,
      SUBTYP_COLOR_CHANNELS,
      DEFAULT_TYP_COLOR
    } = require_typ_colors();
    var VIEW_TYPE_TYP_PANE = "typ-system-pane";
    var DEFAULT_SORT_ORDER2 = "count-desc";
    var SECONDARY_MODES = [
      { mode: "subtyps", title: "Subtyps in brackets", icon: "brackets" },
      { mode: "rows", title: "Subtyps as rows", icon: "list-tree" },
      { mode: "none", title: "Subtyps hidden", icon: "minus" }
    ];
    var DEFAULT_SECONDARY = SECONDARY_MODES[0].mode;
    function subtypListMode(settings) {
      const mode = settings.typListSecondary;
      return SECONDARY_MODES.some((entry) => entry.mode === mode) ? mode : DEFAULT_SECONDARY;
    }
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
      let skipped = 0;
      for (const file of plugin.typIndex.filesWithTyp(oldKey)) {
        const { status } = await editFrontmatter(plugin.app, file, (doc) => {
          if (typKeyOf(propertyValue(doc.toObject(), TYP_PROPERTY2)) !== oldKey) return;
          doc.set(TYP_PROPERTY2, newValue);
        });
        if (status === "changed") changed++;
        else if (status === "skipped") skipped++;
      }
      return { changed, skipped };
    }
    var NO_NOTES = Object.freeze({ changed: 0, skipped: 0 });
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
        if (result.renamed > 0 || result.skipped > 0) {
          new Notice(`TYP ${result.typ} registered, ${plural(result.renamed, "note")} updated.${skippedText(result.skipped, "updated")}`);
        }
      }
      // The core of registerTyp() without saving, re-rendering and notice, so
      // registerTypWithSubtyp() can register TYP and Subtyp in turn and then save
      // and notify ONCE. Returns { typ, renamed, skipped }, or null if nothing usable is
      // left.
      async applyTypRegistration(typKey) {
        const raw = this.plugin.typIndex.rawValueOf(typKey);
        const normalized = normalizeRawTyp(raw === void 0 ? typKey : raw);
        if (!normalized) return null;
        if (!this.plugin.settings.typs.includes(normalized)) {
          this.plugin.settings.typs.push(normalized);
        }
        const { changed: renamed, skipped } = normalized !== typKey ? await renameTypInNotes(this.plugin, typKey, normalized) : NO_NOTES;
        return { typ: normalized, renamed, skipped };
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
      // render() keeps the scroll position (see there). With subtyp (a click on a
      // Subtyp row) the view starts at that Subtyp's block instead.
      openTypSettings(typ, subtyp = null) {
        this.selectedTyp = typ;
        this._resetScroll = true;
        this.render();
        if (subtyp !== null) this.scrollToSubtyp(subtyp);
      }
      // Brings a Subtyp block of the detail view to the top, a little space above
      // it. Measured rather than scrollIntoView(), which would also scroll the
      // sidebar around the pane.
      scrollToSubtyp(subtyp) {
        const block = [...this.contentEl.querySelectorAll(".typ-block")].find((el) => el.typSection === subtyp);
        if (!block) return;
        const offset = block.getBoundingClientRect().top - this.contentEl.getBoundingClientRect().top;
        this.contentEl.scrollTop += offset - 8;
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
          const listCls = "typ-list nav-files-container" + (this.secondaryMode() === "subtyps" ? " typ-list-subtyp-brackets" : "");
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
          attr: { "aria-label": current.title }
        });
        setIcon(secondaryBtn, current.icon);
        secondaryBtn.addEventListener("click", () => this.cycleSecondary());
      }
      secondaryMode() {
        return subtypListMode(this.plugin.settings);
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
      // Subtyp (renderSubtypManualToggle), each first of the actions, left of
      // rename. An
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
      // The TYP's "Manually creatable", in the detail header left of rename. On
      // by default, so only "off" (false) is stored. Decides whether
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
      // A Subtyp's "Manually creatable", in its block footer left of rename (see
      // renderSectionFooter). Unlike the TYP button it pulls only one
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
        if (secondary === "subtyps") this.renderSubtypPreview(self, typ);
        else this.renderDescriptionInput(self, typ);
        this.renderCountFlair(self, count);
        if (secondary === "rows") {
          const { counts } = this.plugin.typIndex.subtypBucket(typ);
          for (const subtyp of getSubtypNames2(this.plugin.settings, typ)) {
            this.renderSubtypItem(treeItem, typ, subtyp, counts.get(subtyp) ?? 0);
          }
        }
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
          treeItem.typSortable = true;
          let rows = [];
          let gap = null;
          attachPointerDrag(self, {
            canStart: (event) => !this.isEditing && !event.target.closest(".typ-color-wrap, input, .is-being-renamed, [contenteditable='true']"),
            longPressMenu: true,
            onStart: () => {
              rows = [...this.listEl.querySelectorAll(".tree-item")].filter((el) => el.typSortable);
              gap = null;
              treeItem.addClass("is-dragging");
            },
            onMove: (event) => {
              gap = gapIndexAt(rows, event.clientY);
              showDropGap(rows, gap === index || gap === index + 1 ? null : gap);
            },
            onEnd: async (commit) => {
              treeItem.removeClass("is-dragging");
              showDropGap(rows, null);
              if (!commit || gap === null || gap === index || gap === index + 1) return;
              const insertBefore = index < gap ? gap - 1 : gap;
              const typs = this.plugin.settings.typs;
              const [moved] = typs.splice(index, 1);
              typs.splice(insertBefore, 0, moved);
              await this.plugin.saveSettings();
              this.render();
            }
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
        this.addRenameItems(menu, {
          rename: () => this.startListRename(typ, self, nameEl),
          renameWithNotes: () => this.openTypRenameModal(typ)
        });
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
      // Right-click on a Subtyp row in the list or on a Subtyp block's heading or
      // footer in the detail view: like showTypMenu, with the actions of the
      // block's footer. startRename() puts the name where it was clicked into
      // input mode. "Create Base" makes the standalone Subtyp Base, as the
      // command does when a Subtyp is picked (see createBaseCommand).
      showSubtypMenu(event, typ, subtyp, startRename) {
        const menu = new Menu();
        menu.addItem(
          (item) => item.setTitle("Search notes").setIcon("search").onClick(() => this.openSubtypSearch(typ, subtyp))
        );
        menu.addSeparator();
        this.addRenameItems(menu, {
          rename: startRename,
          renameWithNotes: () => this.openSubtypRenameModal(typ, subtyp)
        });
        menu.addItem(
          (item) => item.setTitle("Delete").setIcon("trash").setWarning(true).onClick(() => this.deleteSubtypWithConfirm(typ, subtyp))
        );
        menu.addSeparator();
        if (isBasesEnabled(this.app)) {
          menu.addItem(
            (item) => item.setTitle("Create Base").setIcon("table").onClick(runOrReportError("Create Base", () => createBaseFor(this.plugin, { typ: null, subtyp })))
          );
        }
        menu.addItem(
          (item) => item.setTitle("Sort frontmatter for this Subtyp").setIcon("arrow-down-up").onClick(runOrReportError("Frontmatter sorting", () => runFrontmatterSort(this.plugin, typ, subtyp)))
        );
        menu.showAtMouseEvent(event);
      }
      // "Rename" and "Rename and update notes" of the context menus and of the
      // rename button (renderRenameButton). rename edits the name inline and
      // changes only the settings; renameWithNotes opens the rename dialog (see
      // openTypRenameModal), which also rewrites notes - hence the accent color.
      // MenuItem has no API for a color, so the class goes on its element
      // (item.dom, which setWarning() styles the same way).
      addRenameItems(menu, { rename, renameWithNotes }) {
        menu.addItem(
          (item) => item.setTitle("Rename").setIcon("pencil").onClick(() => rename())
        );
        menu.addItem((item) => {
          item.setTitle("Rename and update notes").setIcon("pencil").onClick(() => renameWithNotes());
          item.dom?.addClass("typ-menu-accent");
        });
      }
      // The one rename button of the detail header and of a Subtyp block's
      // footer: opens the two rename items (addRenameItems) right below it, like
      // Obsidian's own buttons with a menu. The button stays highlighted while
      // the menu is open (has-active-menu, set by Menu.setParentElement); a second
      // click on it only closes the menu.
      renderRenameButton(parent, actions) {
        const button = parent.createDiv({ cls: "clickable-icon typ-detail-rename", attr: { "aria-label": "Rename" } });
        setIcon(button, "pencil");
        button.addEventListener("click", () => {
          if (button.hasClass("has-active-menu")) return;
          const menu = new Menu();
          this.addRenameItems(menu, actions);
          const rect = button.getBoundingClientRect();
          menu.setParentElement(button);
          menu.showAtPosition({ x: rect.left, y: rect.bottom, width: rect.width, overlap: true }, button.doc);
        });
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
      // preview in the two-step TYP-Picker (shared nameColor in typ-colors.js):
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
      // A registered Subtyp in mode "Subtyps as rows", below its TYP row and
      // inside its tree-item (see renderRegisteredItem): "TYP / Subtyp", the TYP
      // part faint, the Subtyp part in its color (see subtypRowColor), plus its
      // note count. No dot: an invisible one keeps the text in line with the TYP
      // names above (.typ-color-spacer). Every registered Subtyp shows, manually
      // creatable or not, in block order. A click opens the TYP's detail view at
      // this Subtyp's block, right-click its own menu (showSubtypMenu).
      renderSubtypItem(treeItem, typ, subtyp, count) {
        const self = treeItem.createDiv({ cls: "tree-item-self is-clickable typ-subtyp-row" });
        self.createDiv({ cls: "typ-color-wrap typ-color-spacer" });
        const inner = self.createDiv({ cls: "tree-item-inner" });
        appendSubtypPathPrefix(inner, typ);
        const nameEl = inner.createSpan({ cls: "typ-subtyp-row-name", text: subtyp });
        const color = subtypRowColor(this.plugin.settings, typ, subtyp);
        if (color) nameEl.style.color = color;
        this.renderCountFlair(self, count);
        self.addEventListener("click", () => {
          if (this.isEditing) return;
          this.openTypSettings(typ, subtyp);
        });
        this.attachSubtypMenu(self, typ, subtyp, () => this.startListSubtypRename(typ, subtyp, self, nameEl));
      }
      // Opens showSubtypMenu on right-click (on touch: long press) on el. While a
      // name is being edited, the text field's own menu (copy, paste) applies.
      attachSubtypMenu(el, typ, subtyp, startRename) {
        el.addEventListener("contextmenu", (event) => {
          if (this.isEditing) return;
          event.preventDefault();
          event.stopPropagation();
          this.showSubtypMenu(event, typ, subtyp, startRename);
        });
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
      // part carries its color (or a dot, depending on "TYP-Pane and -Picker"
      // coloring), toned down by the Style Setting "Color in unregistered Subtyp
      // rows" so these rows stay behind the registered entries above. If the TYP
      // isn't registered either, the whole row is muted like the entries above
      // it. The separator is the same Style Setting as in the registered Subtyp
      // rows (.typ-subtyp-sep).
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
        inner.createSpan({ cls: "typ-subtyp-sep typ-unregistered-subtyp-slash" });
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
        const typResult = this.plugin.settings.typs.includes(typKey) ? { typ: typKey, renamed: 0, skipped: 0 } : await this.applyTypRegistration(typKey);
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
        const skipped = typResult.skipped + subtypResult.skipped;
        new Notice(
          `${joinAnd(parts)} registered${changed > 0 ? `, ${plural(changed, "note")} updated` : ""}.${skippedText(skipped, "updated")}`
        );
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
        this.renderManualToggle(header, typ);
        this.renderRenameButton(header, {
          rename: () => this.startDetailRename(typ, titleEl),
          renameWithNotes: () => this.openTypRenameModal(typ)
        });
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
      // alone), search on click, and the add button for a blank row in this
      // block.
      renderSectionHeader(el, typ, section, bucket, blocks) {
        const titleGroup = el.createDiv({ cls: "typ-frontmatter-title-group" });
        const titleEl = titleGroup.createDiv({ cls: "typ-detail-section-title", text: section ?? `${typ}-Frontmatter` });
        const count = section === null ? bucket.noSubtyp : bucket.counts.get(section) ?? 0;
        titleGroup.createSpan({ cls: "typ-subtyp-count", text: String(count) });
        this.makeSearchable(titleEl, () => this.openSubtypSearch(typ, section));
        if (section !== null) {
          this.attachSubtypMenu(el, typ, section, () => this.startSubtypRename(typ, section, titleEl));
        }
        const addButtons = el.createDiv({ cls: "typ-frontmatter-add-group" });
        const addPropertyBtn = addButtons.createDiv({
          cls: "clickable-icon typ-frontmatter-add",
          attr: { "aria-label": "Add property" }
        });
        setIcon(addPropertyBtn, "plus");
        addPropertyBtn.addEventListener("click", () => blocks.addBlank(section));
      }
      // Footer of a Subtyp block: on the left the Subtyp color (a dot opening the
      // sliders, reset next to it), on the right the same actions in the same order
      // as the detail header (manually creatable, rename, delete). The
      // TYP-Frontmatter has no footer. The title is looked up on click - heading
      // and footer are rebuilt on every synchronize().
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
        const rename = () => {
          const target = titleEl();
          if (target) this.startSubtypRename(typ, subtyp, target);
        };
        this.attachSubtypMenu(el, typ, subtyp, rename);
        this.renderSubtypManualToggle(actions, typ, subtyp);
        this.renderRenameButton(actions, {
          rename,
          renameWithNotes: () => this.openSubtypRenameModal(typ, subtyp)
        });
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
      // position; only the settings change (see commitSubtypRename).
      startSubtypRename(typ, subtyp, titleEl) {
        this.startInlineEdit(titleEl, {
          classes: ["typ-subtyp-name-input", "is-being-renamed"],
          // The title sits among Obsidian's property editors, whose keyboard
          // navigation would react too.
          stopAllKeys: true,
          onFinish: (commit, text) => commit ? this.commitSubtypRename(typ, subtyp, text) : this.render()
        });
      }
      // The same from a Subtyp row's context menu: only the Subtyp part of the row
      // becomes the input (the TYP part stays as it is).
      startListSubtypRename(typ, subtyp, self, nameEl) {
        this.startInlineEdit(nameEl, {
          classEl: self,
          onFinish: (commit, text) => commit ? this.commitSubtypRename(typ, subtyp, text) : this.render()
        });
      }
      // "Rename" of a Subtyp: settings only, notes keep their SUBTYP (and then
      // show it as unregistered). An existing name merges into it the same way
      // (mergeSubtypSettingsOnly).
      async commitSubtypRename(typ, subtyp, rawText) {
        const value = normalizeSubtypName(rawText);
        if (!value || value === subtyp) {
          this.render();
          return;
        }
        const existing = this.existingSubtyp(typ, subtyp, value);
        if (existing) {
          this.mergeSubtypSettingsOnly(typ, subtyp, existing);
          return;
        }
        renameSubtyp(this.plugin.settings, typ, subtyp, value);
        await this.plugin.saveSettings();
        this.refreshOtherViews();
        this.render();
      }
      // Another registered Subtyp of typ named like value in any case, or
      // undefined.
      existingSubtyp(typ, subtyp, value) {
        return getSubtypNames2(this.plugin.settings, typ).find(
          (name) => name.toLowerCase() === value.toLowerCase() && name !== subtyp
        );
      }
      subtypCount(typ, subtyp) {
        return this.plugin.typIndex.subtypBucket(typ).counts.get(subtyp) ?? 0;
      }
      // "Rename" onto an existing Subtyp: only the block's properties move into
      // the target (see mergeSubtyps); no note is touched, so the notes of the old
      // name show up as an unregistered Subtyp, and the merge can be undone. Asks
      // only if there are properties to move - without them it is the same as
      // deleting the Subtyp, which can be undone too.
      mergeSubtypSettingsOnly(typ, source, target) {
        const apply = async () => {
          const snapshot = snapshotSettings(this.plugin);
          mergeSubtyps(this.plugin.settings, typ, source, target);
          await this.plugin.saveSettings();
          offerUndo(this.plugin, `Subtyp ${source} merged into ${target}.`, snapshot);
          this.refreshOtherViews();
          this.render();
        };
        if (!blockHasProperties(getSubtyp2(this.plugin.settings, typ, source)?.frontmatter)) {
          apply();
          return;
        }
        new ConfirmModal(this.app, {
          title: ["Merge ", subtypNameNode(this.plugin, typ, source), " into ", subtypNameNode(this.plugin, typ, target), "?"],
          body: [
            `${target} already exists in ${typ}. The properties of ${source} move into its block. Notes keep their SUBTYP ${source}.`
          ],
          confirmText: "Merge",
          focus: "confirm",
          onConfirm: apply,
          onCancel: () => this.render()
        }).open();
      }
      // "Rename and update notes" of a Subtyp: the new name typed into the rename
      // dialog, which is also the confirmation (see RenameModal). Renames the
      // Subtyp and rewrites the SUBTYP of its notes; an existing name turns the
      // dialog into a merge, which moves the notes and the block's properties.
      // The new name keeps the old one's color offset (see renameSubtyp).
      openSubtypRenameModal(typ, subtyp) {
        const count = this.subtypCount(typ, subtyp);
        new RenameModal(this.app, {
          title: ["Rename ", subtypNameNode(this.plugin, typ, subtyp)],
          value: subtyp,
          preview: (text) => {
            const value = normalizeSubtypName(text);
            const existing = value && this.existingSubtyp(typ, subtyp, value);
            if (existing) {
              return {
                confirmText: "Merge",
                warning: true,
                ready: true,
                body: [
                  [
                    subtypNameNode(this.plugin, typ, existing),
                    ` already exists in ${typ}. ${plural(count, "note")} ${count === 1 ? "moves" : "move"} to it, and the properties of ${subtyp} move into its block.`
                  ]
                ]
              };
            }
            return {
              confirmText: "Rename",
              ready: !!value && value !== subtyp,
              body: [`${plural(count, "note")} will be updated.`]
            };
          },
          onSubmit: async (text) => {
            const value = normalizeSubtypName(text);
            const target = this.existingSubtyp(typ, subtyp, value) ?? value;
            const merge = target !== value;
            if (merge) mergeSubtyps(this.plugin.settings, typ, subtyp, target);
            else renameSubtyp(this.plugin.settings, typ, subtyp, target);
            await this.plugin.saveSettings();
            const { changed, skipped } = await renameSubtypInNotes(this.plugin, typ, subtyp, target);
            this.refreshOtherViews();
            new Notice(
              (merge ? `Subtyp ${subtyp} merged into ${target}, ` : `Subtyp ${target}: `) + `${plural(changed, "note")} updated.${skippedText(skipped, "updated")}`
            );
            this.render();
          }
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
        if (result.renamed > 0 || result.skipped > 0) {
          new Notice(
            `Subtyp ${result.subtyp} registered, ${plural(result.renamed, "note")} updated.${skippedText(result.skipped, "updated")}`
          );
        }
      }
      // Like applyTypRegistration: the core without saving and notice, so
      // registerTypWithSubtyp() can bundle it. Returns { subtyp, renamed, skipped }
      // or null.
      async applySubtypRegistration(typ, subtypKey, bucket) {
        const raw = bucket.rawByKey.get(subtypKey);
        const normalized = normalizeRawTyp(raw === void 0 ? subtypKey : raw, normalizeSubtypName);
        if (!normalized) return null;
        const existing = getSubtypNames2(this.plugin.settings, typ).find((name) => name.toLowerCase() === normalized.toLowerCase());
        const subtyp = existing ?? normalized;
        ensureSubtyp(this.plugin.settings, typ, subtyp);
        const { changed: renamed, skipped } = subtyp !== subtypKey ? await renameSubtypInNotes(this.plugin, typ, subtypKey, subtyp) : NO_NOTES;
        return { subtyp, renamed, skipped };
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
        setIcon(addButtons.createDiv({ cls: "clickable-icon typ-frontmatter-add" }), "plus");
        const footer = block.createDiv({ cls: "typ-section-footer typ-subtyp-actions" });
        const colorGroup = footer.createDiv({ cls: "typ-subtyp-color-group" });
        paintColorDot(colorGroup.createDiv({ cls: "typ-subtyp-color-dot" }), this.plugin.settings.typColors[typ] ?? DEFAULT_TYP_COLOR, true);
        setIcon(colorGroup.createDiv({ cls: "clickable-icon typ-color-reset is-disabled" }), "rotate-ccw");
        const actions = footer.createDiv({ cls: "typ-subtyp-action-group" });
        const manualCls = "clickable-icon typ-manual-icon" + (this.ensureTypManual()[typ] !== false ? " is-active" : "");
        setIcon(actions.createDiv({ cls: manualCls }), "file-pen-line");
        setIcon(actions.createDiv({ cls: "clickable-icon typ-detail-rename" }), "pencil");
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
      // "Rename" from the list's context menu: the name in the row becomes the
      // input, the rest is the same as in the detail view (commitTypRename).
      startListRename(typ, self, nameEl) {
        if (this.isEditing) return;
        this.startInlineEdit(nameEl, {
          classEl: self,
          onFinish: (commit, text) => commit ? this.commitTypRename(typ, text) : this.render()
        });
      }
      // "Rename" of the detail header's rename button, on the title.
      startDetailRename(typ, titleEl) {
        this.startInlineEdit(titleEl, {
          onFinish: (commit, text) => commit ? this.commitTypRename(typ, text) : this.render()
        });
      }
      // "Rename" of a TYP, shared by list and detail view: settings only, notes
      // keep their TYP (and then show it as unregistered). An existing name
      // merges into it the same way (mergeTypSettingsOnly).
      async commitTypRename(typ, rawText) {
        const value = normalizeTypName(rawText);
        if (!value || value === typ) {
          this.render();
          return;
        }
        const existing = this.existingTyp(typ, value);
        if (existing) {
          this.mergeTypSettingsOnly(typ, existing);
          return;
        }
        await this.renameTypSettings(typ, value);
        this.render();
      }
      // Another registered TYP named like value in any case, or undefined.
      existingTyp(typ, value) {
        return this.plugin.settings.typs.find((t) => t.toLowerCase() === value.toLowerCase() && t !== typ);
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
      // "Rename" onto an existing TYP: the settings merge (mergeTypSettings -
      // TYP-Frontmatter and Subtyps move into target), no note is touched. The
      // notes of source then show up as an unregistered TYP, and the merge can be
      // undone. Asks only if source has something to move (properties or
      // Subtyps); otherwise it is the same as deleting source, which can be undone
      // too.
      mergeTypSettingsOnly(source, target) {
        const { settings } = this.plugin;
        const apply = async () => {
          const snapshot = snapshotSettings(this.plugin);
          this.applyTypMerge(source, target);
          await this.plugin.saveSettings();
          offerUndo(this.plugin, `TYP ${source} merged into ${target}.`, snapshot);
          this.refreshOtherViews();
          this.render();
        };
        if (!typHasMergeableSettings(settings, source)) {
          apply();
          return;
        }
        new ConfirmModal(this.app, {
          title: [
            "Merge ",
            typNameNode(this.plugin, source, settings.typColors[source] ?? null),
            " into ",
            typNameNode(this.plugin, target, settings.typColors[target] ?? null),
            "?"
          ],
          body: [`${target} already exists. ${this.typMergeText(source)} Notes keep their TYP ${source}.`],
          confirmText: "Merge",
          focus: "confirm",
          onConfirm: apply,
          onCancel: () => this.render()
        }).open();
      }
      // What a merge does with source's settings, for both merge dialogs.
      typMergeText(source) {
        const subtyps = getSubtypNames2(this.plugin.settings, source).length > 0;
        return `The TYP-Frontmatter of ${source} moves into it` + (subtyps ? `, and every Subtyp moves along (blocks with the same name are merged)` : "") + `. Its color and description are dropped.`;
      }
      // The settings side of every TYP merge: source goes into target (see
      // mergeTypSettings in typ-settings.js).
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
      applyTypMerge(source, target) {
        const { settings } = this.plugin;
        mergeTypSettings(settings, source, target);
        if (this.ensureTypManual()[target] === false) setAllSubtypsManual(settings, target, false);
        if (this.selectedTyp === source) this.selectedTyp = target;
      }
      // "Rename and update notes" of a TYP: the new name typed into the rename
      // dialog, which is also the confirmation (see RenameModal). Renames the TYP
      // and rewrites the TYP of every affected note (renameTypInNotes); an
      // existing name turns the dialog into a merge, which moves the notes and
      // source's settings (applyTypMerge). Same color for old and new name: the
      // new one takes over the old one's (see renameTypSettings).
      openTypRenameModal(typ) {
        const { settings } = this.plugin;
        const count = this.plugin.typIndex.typCounts().counts.get(typ) ?? 0;
        new RenameModal(this.app, {
          title: ["Rename ", typNameNode(this.plugin, typ, settings.typColors[typ] ?? null)],
          value: typ,
          preview: (text) => {
            const value = normalizeTypName(text);
            const existing = value && this.existingTyp(typ, value);
            if (existing) {
              return {
                confirmText: "Merge",
                warning: true,
                ready: true,
                body: [
                  [
                    typNameNode(this.plugin, existing, settings.typColors[existing] ?? null),
                    ` already exists. ${plural(count, "note")} ${count === 1 ? "moves" : "move"} to it. ` + this.typMergeText(typ)
                  ]
                ]
              };
            }
            return {
              confirmText: "Rename",
              ready: !!value && value !== typ,
              body: [`${plural(count, "note")} will be updated.`]
            };
          },
          onSubmit: async (text) => {
            const value = normalizeTypName(text);
            const existing = this.existingTyp(typ, value);
            if (existing) {
              await this.mergeTyp(typ, existing);
              return;
            }
            await this.renameTypSettings(typ, value);
            const { changed, skipped } = await renameTypInNotes(this.plugin, typ, value);
            new Notice(`TYP ${value}: ${plural(changed, "note")} updated.${skippedText(skipped, "updated")}`);
            this.render();
          }
        }).open();
      }
      // Merges source into target with its notes: the notes are rewritten to
      // target, then the settings merge (applyTypMerge).
      async mergeTyp(source, target) {
        const { changed, skipped } = await renameTypInNotes(this.plugin, source, target);
        this.applyTypMerge(source, target);
        await this.plugin.saveSettings();
        this.refreshOtherViews();
        new Notice(`TYP ${source} merged into ${target}, ${plural(changed, "note")} updated.${skippedText(skipped, "updated")}`);
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
      registerUndoCommand(plugin);
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
    module2.exports = {
      registerTypPane: registerTypPane2,
      VIEW_TYPE_TYP_PANE,
      compareTyps,
      sortTypsByMode: sortTypsByMode2,
      subtypListMode,
      DEFAULT_SORT_ORDER: DEFAULT_SORT_ORDER2,
      DEFAULT_TYP_COLOR
    };
  }
});

// src/view-colors.js
var require_view_colors = __commonJS({
  "src/view-colors.js"(exports2, module2) {
    var { Component } = require("obsidian");
    var { clearInlineColors: clearInlineColors2 } = require_typ_colors();
    var { coalesceFrame } = require_typ_utils();
    function registerColorView(plugin, { key, enabled = () => !!plugin.settings.colorViews[key], start, clear }) {
      let component = null;
      let refreshOn = null;
      const refresh = () => {
        const on = enabled();
        if (on && !component) {
          component = plugin.addChild(new Component());
          refreshOn = start(component);
        } else if (!on && component) {
          plugin.removeChild(component);
          component = refreshOn = null;
          clear();
        } else if (on) {
          refreshOn();
        }
      };
      refresh();
      plugin.register(() => {
        if (component) clear();
      });
      return refresh;
    }
    function registerLeafColors(plugin, { key, enabled, viewTypes, apply, applyInserted = null, attributes = null, events = null, clearKept = null, clearRoots = null }) {
      const leaves = () => viewTypes.flatMap((viewType) => plugin.app.workspace.getLeavesOfType(viewType));
      const start = (component) => {
        let fullRound = false;
        const insertedNodes = /* @__PURE__ */ new Set();
        const flush = coalesceFrame(() => {
          if (fullRound) apply(plugin);
          else applyInserted(plugin, insertedNodes);
          fullRound = false;
          insertedNodes.clear();
        });
        component.register(flush.cancel);
        const refresh = () => {
          fullRound = true;
          flush();
        };
        const observer = new MutationObserver((records) => {
          if (fullRound) return;
          if (!applyInserted) {
            refresh();
            return;
          }
          for (const record of records) {
            if (record.type === "attributes") insertedNodes.add(record.target);
            for (const node of record.addedNodes) {
              if (node.nodeType === Node.ELEMENT_NODE) insertedNodes.add(node);
            }
          }
          if (insertedNodes.size) flush();
        });
        const options = attributes ? { childList: true, subtree: true, attributeFilter: attributes } : { childList: true, subtree: true };
        const observeLeaves = () => {
          for (const leaf of leaves()) observer.observe(leaf.view.containerEl, options);
        };
        component.register(() => observer.disconnect());
        component.registerEvent(plugin.typIndex.on("change", refresh));
        component.registerEvent(
          plugin.app.workspace.on("layout-change", () => {
            observeLeaves();
            refresh();
          })
        );
        events?.(component, refresh);
        let running = true;
        component.register(() => running = false);
        plugin.app.workspace.onLayoutReady(() => {
          if (!running) return;
          observeLeaves();
          refresh();
        });
        return refresh;
      };
      const clear = () => {
        for (const leaf of leaves()) clearInlineColors2(leaf.view.containerEl);
        for (const el of clearRoots?.(plugin) ?? []) clearInlineColors2(el);
        clearKept?.(plugin);
      };
      return registerColorView(plugin, { key, enabled, start, clear });
    }
    module2.exports = { registerColorView, registerLeafColors };
  }
});

// src/file-explorer-colors.js
var require_file_explorer_colors = __commonJS({
  "src/file-explorer-colors.js"(exports2, module2) {
    var { TFile, TFolder } = require("obsidian");
    var { colorForFile, setInlineColor } = require_typ_colors();
    var { registerLeafColors } = require_view_colors();
    var FILE_EXPLORER_VIEW_TYPE = "file-explorer";
    var FOLDER_NOTES_PLUGIN_ID = "folder-notes";
    var TITLE_SELECTOR = ".nav-file-title[data-path], .nav-folder-title[data-path]";
    function getFolderNoteFile(plugin, folder) {
      const folderNotes = plugin.app.plugins.plugins[FOLDER_NOTES_PLUGIN_ID];
      const settings = folderNotes?.settings;
      if (!settings) return null;
      const fileName = (settings.folderNoteName || "{{folder_name}}").replace("{{folder_name}}", folder.name) + (settings.folderNoteType || ".md");
      const parent = folder.parent && !folder.parent.isRoot() ? folder.parent.path : "";
      const dirPath = settings.storageLocation === "parentFolder" ? parent : folder.path;
      const path = dirPath ? `${dirPath}/${fileName}` : fileName;
      const file = plugin.app.vault.getAbstractFileByPath(path);
      return file instanceof TFile ? file : null;
    }
    function applyColorToTitle(plugin, titleEl) {
      const contentEl = titleEl.querySelector(".nav-file-title-content, .nav-folder-title-content");
      if (!contentEl) return;
      const item = plugin.app.vault.getAbstractFileByPath(titleEl.getAttribute("data-path"));
      let file = null;
      if (titleEl.classList.contains("nav-folder-title")) {
        if (item instanceof TFolder) file = getFolderNoteFile(plugin, item);
      } else if (item instanceof TFile) {
        file = item;
      }
      setInlineColor(contentEl, colorForFile(plugin, file, "fileExplorer"));
    }
    function applyFileExplorerColors(plugin) {
      for (const leaf of plugin.app.workspace.getLeavesOfType(FILE_EXPLORER_VIEW_TYPE)) {
        for (const titleEl of leaf.view.containerEl.querySelectorAll(TITLE_SELECTOR)) applyColorToTitle(plugin, titleEl);
      }
    }
    function applyToInsertedNodes(plugin, nodes) {
      for (const node of nodes) {
        if (!node.isConnected) continue;
        const titleEls = node.matches(TITLE_SELECTOR) ? [node] : node.querySelectorAll(TITLE_SELECTOR);
        for (const titleEl of titleEls) applyColorToTitle(plugin, titleEl);
      }
    }
    function clearKeptRows(plugin) {
      for (const leaf of plugin.app.workspace.getLeavesOfType(FILE_EXPLORER_VIEW_TYPE)) {
        for (const item of Object.values(leaf.view.fileItems ?? {})) {
          if (item.innerEl) setInlineColor(item.innerEl, null);
        }
      }
    }
    function registerFileExplorerColors2(plugin) {
      return registerLeafColors(plugin, {
        key: "fileExplorer",
        viewTypes: [FILE_EXPLORER_VIEW_TYPE],
        apply: applyFileExplorerColors,
        applyInserted: applyToInsertedNodes,
        // A row is inserted before it is rendered: Obsidian sets its text and
        // data-path only when the virtualized list first draws it (onRender),
        // which at startup can come after the insertion. Seeing data-path being
        // set catches those rows too.
        attributes: ["data-path"],
        events: (component, refresh) => component.registerEvent(plugin.app.vault.on("rename", refresh)),
        clearKept: clearKeptRows
      });
    }
    module2.exports = { registerFileExplorerColors: registerFileExplorerColors2, getFolderNoteFile };
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

// src/note-embeds.js
var require_note_embeds = __commonJS({
  "src/note-embeds.js"(exports2, module2) {
    var { allDocuments: allDocuments2 } = require_typ_colors();
    var INSERTED_ANIMATION = "typ-embed-inserted";
    function watchEmbeds(plugin, component, { bodyClass, selector, onInserted }) {
      const onAnimationStart = (evt) => {
        if (evt.animationName === INSERTED_ANIMATION && evt.target.matches(selector)) onInserted(evt.target);
      };
      const watchDocument = (doc) => {
        component.registerDomEvent(doc, "animationstart", onAnimationStart);
        doc.body.addClass(bodyClass);
      };
      for (const doc of allDocuments2(plugin.app)) watchDocument(doc);
      component.registerEvent(plugin.app.workspace.on("window-open", (workspaceWindow, win) => watchDocument(win.document)));
      component.register(() => {
        for (const doc of allDocuments2(plugin.app)) doc.body.removeClass(bodyClass);
      });
    }
    function findRenderChild(app, predicate) {
      const seen = /* @__PURE__ */ new Set();
      const visit = (component) => {
        if (!component || seen.has(component)) return null;
        seen.add(component);
        if (predicate(component)) return component;
        for (const child of [component.hoverPopover, ...component._children ?? []]) {
          const found = visit(child);
          if (found) return found;
        }
        return null;
      };
      const roots = [];
      app.workspace.iterateAllLeaves((leaf) => {
        roots.push(leaf.view);
        for (const node of leaf.view.canvas?.nodes?.values() ?? []) roots.push(node.child);
      });
      for (const root of roots) {
        const found = visit(root);
        if (found) return found;
      }
      return null;
    }
    module2.exports = { watchEmbeds, findRenderChild };
  }
});

// src/search-colors.js
var require_search_colors = __commonJS({
  "src/search-colors.js"(exports2, module2) {
    var { Component } = require("obsidian");
    var { colorForFile, setInlineColor, clearInlineColors: clearInlineColors2, allDocuments: allDocuments2 } = require_typ_colors();
    var { coalesceFrame } = require_typ_utils();
    var { registerColorView, registerLeafColors } = require_view_colors();
    var { watchEmbeds, findRenderChild } = require_note_embeds();
    var SEARCH_VIEW_TYPE = "search";
    var TITLE_SELECTOR = ".search-result-file-title .tree-item-inner";
    var QUERY_BLOCK_SELECTOR = ".internal-query";
    var QUERY_BLOCK_WATCH_CLASS = "typ-watch-query-blocks";
    function colorResultRows(plugin, resultDomLookup) {
      for (const [file, resultDom] of resultDomLookup) {
        if (!resultDom.el?.isConnected) continue;
        const titleEl = resultDom.el.querySelector(TITLE_SELECTOR);
        if (titleEl) setInlineColor(titleEl, colorForFile(plugin, file, "search"));
      }
    }
    function clearResultRows(resultDomLookup) {
      for (const resultDom of resultDomLookup.values()) {
        const titleEl = resultDom.el?.querySelector(TITLE_SELECTOR);
        if (titleEl) setInlineColor(titleEl, null);
      }
    }
    function searchResultDomLookups(plugin) {
      return plugin.app.workspace.getLeavesOfType(SEARCH_VIEW_TYPE).map((leaf) => leaf.view?.dom?.resultDomLookup).filter(Boolean);
    }
    function registerSearchColors2(plugin) {
      return registerLeafColors(plugin, {
        key: "search",
        viewTypes: [SEARCH_VIEW_TYPE],
        apply: () => searchResultDomLookups(plugin).forEach((lookup) => colorResultRows(plugin, lookup)),
        clearKept: () => searchResultDomLookups(plugin).forEach(clearResultRows)
      });
    }
    function isQueryComponent(component, blockEl) {
      return component.containerEl?.parentElement === blockEl && component.dom?.resultDomLookup instanceof Map;
    }
    function registerQueryBlockColors2(plugin) {
      return registerColorView(plugin, {
        key: "search",
        start: (component) => {
          const blocks = /* @__PURE__ */ new Map();
          const refresh = coalesceFrame(() => {
            for (const query of blocks.keys()) colorResultRows(plugin, query.dom.resultDomLookup);
          });
          component.register(refresh.cancel);
          const track = (query) => {
            const child = new Component();
            const observer = new MutationObserver(refresh);
            observer.observe(query.containerEl, { childList: true, subtree: true });
            child.register(() => {
              observer.disconnect();
              blocks.delete(query);
            });
            blocks.set(query, child);
            query.addChild(child);
          };
          const onInserted = (blockEl) => {
            const query = findRenderChild(plugin.app, (candidate) => isQueryComponent(candidate, blockEl));
            if (!query) return;
            if (!blocks.has(query)) track(query);
            colorResultRows(plugin, query.dom.resultDomLookup);
          };
          watchEmbeds(plugin, component, { bodyClass: QUERY_BLOCK_WATCH_CLASS, selector: QUERY_BLOCK_SELECTOR, onInserted });
          component.registerEvent(plugin.typIndex.on("change", refresh));
          component.register(() => {
            for (const [query, child] of blocks) {
              query.removeChild(child);
              clearResultRows(query.dom.resultDomLookup);
            }
          });
          return refresh;
        },
        // The rows in the DOM, swept per block rather than through resultDomLookup:
        // a block in a hidden tab can't lay out its list, so a replaced row stays
        // in its DOM after it has left resultDomLookup.
        clear: () => {
          for (const doc of allDocuments2(plugin.app)) {
            for (const blockEl of doc.querySelectorAll(QUERY_BLOCK_SELECTOR)) clearInlineColors2(blockEl);
          }
        }
      });
    }
    module2.exports = { registerSearchColors: registerSearchColors2, registerQueryBlockColors: registerQueryBlockColors2 };
  }
});

// src/bases-colors.js
var require_bases_colors = __commonJS({
  "src/bases-colors.js"(exports2, module2) {
    var { Component } = require("obsidian");
    var { colorForFile, colorForLink, setInlineColor, clearInlineColors: clearInlineColors2, allDocuments: allDocuments2 } = require_typ_colors();
    var { coalesceFrame } = require_typ_utils();
    var { registerColorView } = require_view_colors();
    var { watchEmbeds, findRenderChild } = require_note_embeds();
    var BASES_WATCH_CLASS = "typ-watch-bases";
    var BASES_SELECTOR = '.bases-embed, .workspace-leaf-content[data-type="bases"] > .view-content';
    var ROW_SELECTOR = ".bases-tr, .bases-cards-item, .bases-list-item";
    var GROUP_HEADING_SELECTOR = ".bases-group-heading";
    var LINK_SELECTOR = ".internal-link";
    var FILE_NAME_PROPERTY = "file.name";
    var VIEW_ADAPTERS = {
      table: {
        rows: (view) => [...view.rows ?? [], ...view.unusedRows ?? []],
        cells: (row) => row.cells?.map((cell) => ({ prop: cell.prop, el: cell.el })) ?? [],
        groupEls: (view) => view.groups?.map((group) => group.tableEl) ?? []
      },
      cards: {
        rows: (view) => [...view.items ?? [], ...view.unusedItems ?? []],
        cells: (item) => item.props?.map((prop) => ({ prop: prop.prop, el: prop.el })) ?? [],
        groupEls: (view) => view.groups?.map((group) => group.groupHeadingEl) ?? []
      },
      list: {
        rows: (view) => view.groups?.flatMap((group) => group.rows ?? []) ?? [],
        cells: (row) => row.cells?.map((cell) => ({ prop: cell.propertyId, el: cell.el })) ?? [],
        groupEls: (view) => view.groups?.map((group) => group.groupHeadingEl) ?? []
      }
    };
    function headingsIn(el) {
      if (!el) return [];
      return el.matches(GROUP_HEADING_SELECTOR) ? [el] : el.querySelectorAll(GROUP_HEADING_SELECTOR);
    }
    var FILE_NAME_PART = {
      enabled: (settings) => settings.colorViews.bases,
      colorRow(plugin, row, cells, on) {
        const cellEl = cells.find((cell) => cell.prop === FILE_NAME_PROPERTY)?.el;
        const el = cellEl?.querySelector(LINK_SELECTOR) ?? cellEl?.querySelector(".bases-cards-line");
        if (el) setInlineColor(el, on ? colorForFile(plugin, row.entry?.file, "bases") : null);
      }
    };
    var LINK_PART = {
      enabled: (settings) => settings.colorViews.bases && settings.colorViews.basesLinks,
      colorRow(plugin, row, cells, on) {
        for (const { prop, el } of cells) {
          if (prop === FILE_NAME_PROPERTY || !el) continue;
          for (const linkEl of el.querySelectorAll(LINK_SELECTOR)) {
            const sourcePath = linkEl.closest(".bases-metadata-value") ? row.entry?.file?.path ?? "" : "";
            setInlineColor(linkEl, on ? colorForLink(plugin, linkEl, sourcePath, "basesLinks") : null);
          }
        }
      }
    };
    var GROUP_HEADING_PART = {
      enabled: (settings) => settings.colorViews.bases && settings.colorViews.basesGroupHeadings,
      colorHeading(plugin, headingEl, on) {
        for (const linkEl of headingEl.querySelectorAll(`.bases-group-value ${LINK_SELECTOR}`)) {
          setInlineColor(linkEl, on ? colorForLink(plugin, linkEl, "", "basesGroupHeadings") : null);
        }
      }
    };
    var PARTS = [FILE_NAME_PART, LINK_PART, GROUP_HEADING_PART];
    function colorBase(plugin, controller, parts, insertedNodes = null) {
      const view = controller.view;
      const adapter = VIEW_ADAPTERS[view?.type];
      if (!adapter || !parts.length) return;
      let rowEls = null;
      let headingEls = null;
      if (insertedNodes) {
        rowEls = /* @__PURE__ */ new Set();
        headingEls = /* @__PURE__ */ new Set();
        for (const node of insertedNodes) {
          if (!node.isConnected) continue;
          const rowEl = node.closest(ROW_SELECTOR);
          if (rowEl) rowEls.add(rowEl);
          else for (const el of node.querySelectorAll(ROW_SELECTOR)) rowEls.add(el);
          const headingEl = node.closest(GROUP_HEADING_SELECTOR);
          if (headingEl) headingEls.add(headingEl);
          else for (const el of node.querySelectorAll(GROUP_HEADING_SELECTOR)) headingEls.add(el);
        }
      }
      const rowParts = parts.filter((part) => part.colorRow);
      if (rowParts.length && (!rowEls || rowEls.size)) {
        for (const row of adapter.rows(view)) {
          if (!row.el?.isConnected || rowEls && !rowEls.has(row.el)) continue;
          const cells = adapter.cells(row);
          for (const part of rowParts) part.colorRow(plugin, row, cells, true);
        }
      }
      const headingParts = parts.filter((part) => part.colorHeading);
      if (headingParts.length) {
        for (const headingEl of headingEls ?? controller.viewContainerEl.querySelectorAll(GROUP_HEADING_SELECTOR)) {
          for (const part of headingParts) part.colorHeading(plugin, headingEl, true);
        }
      }
    }
    function clearBase(plugin, controller, part) {
      const view = controller.view;
      const adapter = VIEW_ADAPTERS[view?.type];
      if (!adapter) return;
      if (part.colorRow) {
        for (const row of adapter.rows(view)) {
          if (row.el) part.colorRow(plugin, row, adapter.cells(row), false);
        }
      }
      if (part.colorHeading) {
        const headingEls = new Set(controller.viewContainerEl.querySelectorAll(GROUP_HEADING_SELECTOR));
        for (const el of adapter.groupEls(view)) for (const headingEl of headingsIn(el)) headingEls.add(headingEl);
        for (const headingEl of headingEls) part.colorHeading(plugin, headingEl, false);
      }
    }
    function registerBasesColors2(plugin) {
      const activeParts = () => PARTS.filter((part) => part.enabled(plugin.settings));
      return registerColorView(plugin, {
        key: "bases",
        enabled: () => activeParts().length > 0,
        start: (component) => {
          let parts = activeParts();
          const bases = /* @__PURE__ */ new Map();
          let fullRound = false;
          const flush = coalesceFrame(() => {
            for (const [controller, base] of bases) {
              if (fullRound) colorBase(plugin, controller, parts);
              else if (base.insertedNodes.size) colorBase(plugin, controller, parts, base.insertedNodes);
              base.insertedNodes.clear();
            }
            fullRound = false;
          });
          component.register(flush.cancel);
          const requestFullRound = () => {
            fullRound = true;
            flush();
          };
          const track = (controller) => {
            const child = new Component();
            const base = { child, insertedNodes: /* @__PURE__ */ new Set() };
            const observer = new MutationObserver((records) => {
              if (fullRound) return;
              for (const record of records) {
                for (const node of record.addedNodes) {
                  if (node.nodeType === Node.ELEMENT_NODE) base.insertedNodes.add(node);
                }
              }
              if (base.insertedNodes.size) flush();
            });
            observer.observe(controller.viewContainerEl, { childList: true, subtree: true });
            child.register(() => {
              observer.disconnect();
              bases.delete(controller);
            });
            bases.set(controller, base);
            controller.addChild(child);
          };
          const onInserted = (el) => {
            const controller = findRenderChild(plugin.app, (candidate) => candidate.viewContainerEl?.parentElement === el);
            if (!controller) return;
            if (!bases.has(controller)) track(controller);
            colorBase(plugin, controller, parts);
          };
          watchEmbeds(plugin, component, { bodyClass: BASES_WATCH_CLASS, selector: BASES_SELECTOR, onInserted });
          component.registerEvent(plugin.typIndex.on("change", requestFullRound));
          component.register(() => {
            for (const [controller, base] of [...bases]) {
              for (const part of parts) clearBase(plugin, controller, part);
              controller.removeChild(base.child);
            }
          });
          return () => {
            const next = activeParts();
            for (const part of parts) {
              if (next.includes(part)) continue;
              for (const controller of bases.keys()) clearBase(plugin, controller, part);
            }
            parts = next;
            requestFullRound();
          };
        },
        // Bases whose controller is already gone or that were never found.
        clear: () => {
          for (const doc of allDocuments2(plugin.app)) {
            for (const el of doc.querySelectorAll(".bases-view")) clearInlineColors2(el);
          }
        }
      });
    }
    module2.exports = { registerBasesColors: registerBasesColors2 };
  }
});

// src/recent-files-colors.js
var require_recent_files_colors = __commonJS({
  "src/recent-files-colors.js"(exports2, module2) {
    var { colorForFile, setInlineColor } = require_typ_colors();
    var { registerLeafColors } = require_view_colors();
    var RECENT_FILES_VIEW_TYPE = "recent-files";
    function applyRecentFilesColors(plugin) {
      for (const leaf of plugin.app.workspace.getLeavesOfType(RECENT_FILES_VIEW_TYPE)) {
        const recentFiles = leaf.view?.data?.recentFiles;
        if (!Array.isArray(recentFiles)) continue;
        const titleEls = leaf.view.containerEl.querySelectorAll(".recent-files-title .nav-file-title-content");
        titleEls.forEach((titleEl, index) => {
          const entry = recentFiles[index];
          const file = entry ? plugin.app.vault.getAbstractFileByPath(entry.path) : null;
          setInlineColor(titleEl, colorForFile(plugin, file, "recentFiles"));
        });
      }
    }
    function registerRecentFilesColors2(plugin) {
      return registerLeafColors(plugin, {
        key: "recentFiles",
        viewTypes: [RECENT_FILES_VIEW_TYPE],
        apply: applyRecentFilesColors
      });
    }
    module2.exports = { registerRecentFilesColors: registerRecentFilesColors2 };
  }
});

// src/backlink-colors.js
var require_backlink_colors = __commonJS({
  "src/backlink-colors.js"(exports2, module2) {
    var { colorForFile, setInlineColor } = require_typ_colors();
    var { registerLeafColors } = require_view_colors();
    var BACKLINK_VIEW_TYPE = "backlink";
    var TITLE_SELECTOR = ".search-result-file-title .tree-item-inner";
    var EMBEDDED_SELECTOR = ".embedded-backlinks";
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
      setInlineColor(el, colorForFile(plugin, file, "backlinks"));
    }
    function applyBacklinkPaneColors(plugin) {
      for (const leaf of plugin.app.workspace.getLeavesOfType(BACKLINK_VIEW_TYPE)) {
        for (const lookup of getResultDomLookups(leaf.view)) {
          for (const [file, resultDom] of lookup) {
            if (!resultDom.el?.isConnected) continue;
            const titleEl = resultDom.el.querySelector(TITLE_SELECTOR);
            if (titleEl) colorTitleEl(plugin, titleEl, file);
          }
        }
      }
    }
    function applyEmbeddedBacklinkColors(plugin) {
      for (const leaf of plugin.app.workspace.getLeavesOfType("markdown")) {
        const paneEl = leaf.view.containerEl.querySelector(`${EMBEDDED_SELECTOR} .backlink-pane`);
        if (!paneEl) continue;
        const sourcePath = leaf.view.file?.path ?? "";
        const titleEls = paneEl.querySelectorAll(TITLE_SELECTOR);
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
    function embeddedBacklinkEls(plugin) {
      return plugin.app.workspace.getLeavesOfType("markdown").flatMap((leaf) => [...leaf.view.containerEl.querySelectorAll(EMBEDDED_SELECTOR)]);
    }
    function clearKeptRows(plugin) {
      for (const leaf of plugin.app.workspace.getLeavesOfType(BACKLINK_VIEW_TYPE)) {
        for (const lookup of getResultDomLookups(leaf.view)) {
          for (const resultDom of lookup.values()) {
            const titleEl = resultDom.el?.querySelector(TITLE_SELECTOR);
            if (titleEl) setInlineColor(titleEl, null);
          }
        }
      }
    }
    function registerBacklinkColors2(plugin) {
      return registerLeafColors(plugin, {
        key: "backlinks",
        viewTypes: [BACKLINK_VIEW_TYPE],
        apply: applyBacklinkColors,
        events: (component, refresh) => {
          component.registerEvent(plugin.app.metadataCache.on("resolved", () => applyEmbeddedBacklinkColors(plugin)));
          component.registerEvent(plugin.app.workspace.on("active-leaf-change", refresh));
        },
        clearKept: clearKeptRows,
        clearRoots: embeddedBacklinkEls
      });
    }
    module2.exports = { registerBacklinkColors: registerBacklinkColors2 };
  }
});

// src/outgoing-link-colors.js
var require_outgoing_link_colors = __commonJS({
  "src/outgoing-link-colors.js"(exports2, module2) {
    var { colorForFile, setInlineColor } = require_typ_colors();
    var { registerLeafColors } = require_view_colors();
    var OUTGOING_LINK_VIEW_TYPE = "outgoing-link";
    var LINK_TEXT_SELECTOR = ".tree-item-inner-text";
    var DESTINATION_SELECTOR = ".search-result-file-match-destination-file-name";
    function outgoingLinkPanes(plugin) {
      return plugin.app.workspace.getLeavesOfType(OUTGOING_LINK_VIEW_TYPE).map((leaf) => leaf.view?.outgoingLink).filter(Boolean);
    }
    function forEachLinkItem(pane, callback) {
      for (const item of pane.outgoingLinkDom?.vChildren?.children ?? []) {
        if (item.el) callback(item);
      }
    }
    function forEachMention(pane, callback) {
      const lookup = pane.unlinkedDom?.resultDomLookup;
      if (!(lookup instanceof Map)) return;
      for (const resultDom of lookup.values()) {
        for (const match of resultDom.vChildren?.children ?? []) {
          if (match.el) callback(match, pane.unlinkedDomInfo?.get(match));
        }
      }
    }
    function linkTarget(plugin, item) {
      const iconEl = item.el.querySelector(".tree-item-icon .svg-icon");
      if (!iconEl || iconEl.classList.contains("lucide-file-plus")) return null;
      const pathSelector = iconEl.classList.contains("lucide-link") ? LINK_TEXT_SELECTOR : ".tree-item-inner-subtext";
      const linkpath = item.el.querySelector(pathSelector)?.textContent;
      return linkpath ? plugin.app.metadataCache.getFirstLinkpathDest(linkpath, item.sourcePath) : null;
    }
    function applyOutgoingLinkColors(plugin) {
      for (const pane of outgoingLinkPanes(plugin)) {
        forEachLinkItem(pane, (item) => {
          if (!item.el.isConnected) return;
          const textEl = item.el.querySelector(LINK_TEXT_SELECTOR);
          if (textEl) setInlineColor(textEl, colorForFile(plugin, linkTarget(plugin, item), "outgoingLinks"));
        });
        forEachMention(pane, (match, info) => {
          if (!match.el.isConnected) return;
          match.el.querySelectorAll(DESTINATION_SELECTOR).forEach((nameEl, index) => {
            setInlineColor(nameEl, colorForFile(plugin, info?.files?.[index], "outgoingLinks"));
          });
        });
      }
    }
    function clearKeptRows(plugin) {
      for (const pane of outgoingLinkPanes(plugin)) {
        forEachLinkItem(pane, (item) => {
          const textEl = item.el.querySelector(LINK_TEXT_SELECTOR);
          if (textEl) setInlineColor(textEl, null);
        });
        forEachMention(pane, (match) => {
          match.el.querySelectorAll(DESTINATION_SELECTOR).forEach((nameEl) => setInlineColor(nameEl, null));
        });
      }
    }
    function registerOutgoingLinkColors2(plugin) {
      return registerLeafColors(plugin, {
        key: "outgoingLinks",
        viewTypes: [OUTGOING_LINK_VIEW_TYPE],
        apply: applyOutgoingLinkColors,
        clearKept: clearKeptRows
      });
    }
    module2.exports = { registerOutgoingLinkColors: registerOutgoingLinkColors2 };
  }
});

// src/bookmark-colors.js
var require_bookmark_colors = __commonJS({
  "src/bookmark-colors.js"(exports2, module2) {
    var { colorForFile, setInlineColor } = require_typ_colors();
    var { registerLeafColors } = require_view_colors();
    var BOOKMARKS_VIEW_TYPE = "bookmarks";
    var BOOKMARKS_PLUGIN_ID = "bookmarks";
    function forEachFileBookmark(items, callback) {
      for (const item of items ?? []) {
        if (item.type === "file") callback(item);
        else if (item.type === "group") forEachFileBookmark(item.items, callback);
      }
    }
    function forEachBookmarkTitle(plugin, callback) {
      const bookmarksPlugin = plugin.app.internalPlugins.getEnabledPluginById(BOOKMARKS_PLUGIN_ID);
      if (!bookmarksPlugin) return;
      for (const leaf of plugin.app.workspace.getLeavesOfType(BOOKMARKS_VIEW_TYPE)) {
        const itemDoms = leaf.view?.itemDoms;
        if (!itemDoms) continue;
        forEachFileBookmark(bookmarksPlugin.items, (item) => {
          const titleEl = itemDoms.get(item)?.titleEl;
          if (titleEl) callback(titleEl, item);
        });
      }
    }
    function applyBookmarksColors(plugin) {
      forEachBookmarkTitle(plugin, (titleEl, item) => {
        const file = plugin.app.vault.getAbstractFileByPath(item.path);
        setInlineColor(titleEl, colorForFile(plugin, file, "bookmarks"));
      });
    }
    function registerBookmarksColors2(plugin) {
      return registerLeafColors(plugin, {
        key: "bookmarks",
        viewTypes: [BOOKMARKS_VIEW_TYPE],
        apply: applyBookmarksColors,
        clearKept: (plugin2) => forEachBookmarkTitle(plugin2, (titleEl) => setInlineColor(titleEl, null))
      });
    }
    module2.exports = { registerBookmarksColors: registerBookmarksColors2 };
  }
});

// src/active-title-colors.js
var require_active_title_colors = __commonJS({
  "src/active-title-colors.js"(exports2, module2) {
    var { TFile } = require("obsidian");
    var { colorForFile, subtypColor, subtypHasOwnColor, setInlineColor, DEFAULT_TYP_COLOR } = require_typ_colors();
    var { getSubtyp: getSubtyp2 } = require_subtyps();
    var DOT_CLASS = "typ-title-dot";
    var DOT_HOLLOW_CLASS = "typ-title-dot-hollow";
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
      const typColor = settings.typColors[typ] ?? DEFAULT_TYP_COLOR;
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
        return settings.typs.includes(typ) ? { color: DEFAULT_TYP_COLOR, hollow: true } : { color: null, hollow: false };
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
    function applyActiveTitleColors(plugin, titleObserver) {
      for (const leaf of plugin.app.workspace.getLeavesOfType("markdown")) {
        const containerEl = leaf.view.containerEl;
        const file = leaf.view.file;
        const typedFile = file instanceof TFile ? file : null;
        const marker = resolveMarker(plugin, typedFile);
        const titleEl = containerEl.querySelector(".inline-title");
        if (titleEl) {
          titleObserver.observe(titleEl, { childList: true });
          applyStyleToTitle(titleEl, marker);
          const textColor = plugin.settings.colorViews.noteTitleColor ? colorForFile(plugin, typedFile, "noteTitleColor") : null;
          setInlineColor(titleEl, textColor);
        }
        const blockEl = containerEl.querySelector(".metadata-container");
        if (blockEl) applyStyleToBlock(plugin, blockEl, marker);
      }
    }
    function registerActiveTitleColors2(plugin) {
      const titleObserver = new MutationObserver(() => refresh());
      plugin.register(() => titleObserver.disconnect());
      const refresh = () => applyActiveTitleColors(plugin, titleObserver);
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

// src/header-colors.js
var require_header_colors = __commonJS({
  "src/header-colors.js"(exports2, module2) {
    var { TFile } = require("obsidian");
    var { colorForFile, setInlineColor, clearInlineColors: clearInlineColors2 } = require_typ_colors();
    var { coalesceFrame } = require_typ_utils();
    var { registerColorView } = require_view_colors();
    var { getFolderNoteFile } = require_file_explorer_colors();
    function titleFile(plugin, leaf) {
      const view = leaf.view;
      let file = view?.file;
      if (!file && leaf.isDeferred) file = plugin.app.vault.getAbstractFileByPath(view.getState?.()?.file ?? "");
      return file instanceof TFile && view.getDisplayText() === file.basename ? file : null;
    }
    function breadcrumbFolders(file) {
      const folders = [];
      for (let folder = file?.parent; folder && !folder.isRoot(); folder = folder.parent) folders.unshift(folder);
      return folders;
    }
    function colorTitle(plugin, leaf, titleEl, viewKey) {
      if (titleEl && titleEl.textContent === leaf.view.getDisplayText()) {
        setInlineColor(titleEl, colorForFile(plugin, titleFile(plugin, leaf), viewKey));
      }
    }
    function colorTabTitle(plugin, leaf) {
      colorTitle(plugin, leaf, leaf.tabHeaderInnerTitleEl, "tabTitles");
    }
    function colorViewHeader(plugin, leaf) {
      const view = leaf.view;
      colorTitle(plugin, leaf, view?.titleEl, "viewHeader");
      if (!view?.titleParentEl) return;
      const folders = breadcrumbFolders(view.file instanceof TFile ? view.file : null);
      view.titleParentEl.querySelectorAll(":scope > .view-header-breadcrumb").forEach((crumbEl, index) => {
        const folder = folders[index];
        setInlineColor(crumbEl, folder ? colorForFile(plugin, getFolderNoteFile(plugin, folder), "viewHeader") : null);
      });
    }
    function registerLeafTitleColors(plugin, { key, targets, apply, clearLeaf, extra = null, applyExtra = null, clearExtra = null }) {
      const start = (component) => {
        const leafOf = /* @__PURE__ */ new WeakMap();
        const watch = (leaf) => {
          for (const el of [leaf.containerEl, ...targets(leaf)]) {
            if (!el || leafOf.get(el) === leaf) continue;
            leafOf.set(el, leaf);
            observer.observe(el, { childList: true });
          }
        };
        const observer = new MutationObserver((records) => {
          const leaves = /* @__PURE__ */ new Set();
          for (const record of records) {
            const leaf = leafOf.get(record.target);
            if (leaf) leaves.add(leaf);
          }
          for (const leaf of leaves) {
            watch(leaf);
            apply(leaf);
          }
        });
        component.register(() => observer.disconnect());
        const round = () => {
          plugin.app.workspace.iterateAllLeaves((leaf) => {
            watch(leaf);
            apply(leaf);
          });
          applyExtra?.();
        };
        const refresh = coalesceFrame(round);
        component.register(refresh.cancel);
        component.registerEvent(plugin.typIndex.on("change", refresh));
        component.registerEvent(plugin.app.workspace.on("layout-change", refresh));
        component.registerEvent(plugin.app.workspace.on("window-open", refresh));
        extra?.(component, refresh);
        let running = true;
        component.register(() => running = false);
        plugin.app.workspace.onLayoutReady(() => {
          if (running) round();
        });
        return refresh;
      };
      const clear = () => {
        plugin.app.workspace.iterateAllLeaves((leaf) => {
          clearLeaf(leaf);
        });
        clearExtra?.();
      };
      return registerColorView(plugin, { key, start, clear });
    }
    function forEachSwitcherTitle(plugin, callback) {
      const previews = plugin.app.mobileTabSwitcher?.tabPreviews ?? {};
      for (const preview of Object.values(previews)) {
        if (preview.titleEl && preview.leaf) callback(preview.titleEl, preview.leaf);
      }
    }
    function registerTabTitleColors2(plugin) {
      const colorSwitcher = () => forEachSwitcherTitle(plugin, (titleEl, leaf) => setInlineColor(titleEl, colorForFile(plugin, titleFile(plugin, leaf), "tabTitles")));
      return registerLeafTitleColors(plugin, {
        key: "tabTitles",
        targets: (leaf) => [leaf.tabHeaderInnerTitleEl],
        apply: (leaf) => colorTabTitle(plugin, leaf),
        clearLeaf: (leaf) => {
          if (leaf.tabHeaderInnerTitleEl) setInlineColor(leaf.tabHeaderInnerTitleEl, null);
        },
        extra: (component) => {
          const listEl = plugin.app.mobileTabSwitcher?.innerScrollEl;
          if (!listEl) return;
          const observer = new MutationObserver(colorSwitcher);
          observer.observe(listEl, { childList: true, subtree: true });
          component.register(() => observer.disconnect());
        },
        applyExtra: colorSwitcher,
        clearExtra: () => forEachSwitcherTitle(plugin, (titleEl) => setInlineColor(titleEl, null))
      });
    }
    function registerViewHeaderColors2(plugin) {
      return registerLeafTitleColors(plugin, {
        key: "viewHeader",
        targets: (leaf) => [leaf.view?.titleEl, leaf.view?.titleParentEl],
        apply: (leaf) => colorViewHeader(plugin, leaf),
        clearLeaf: (leaf) => {
          const containerEl = leaf.view?.titleContainerEl;
          if (containerEl) clearInlineColors2(containerEl);
        },
        extra: (component, refresh) => {
          let running = true;
          component.register(() => running = false);
          plugin.app.workspace.onLayoutReady(() => {
            if (!running) return;
            for (const name of ["create", "delete", "rename"]) component.registerEvent(plugin.app.vault.on(name, refresh));
          });
        }
      });
    }
    module2.exports = { registerTabTitleColors: registerTabTitleColors2, registerViewHeaderColors: registerViewHeaderColors2 };
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
    var { coalesceFrame } = require_typ_utils();
    var { registerColorView } = require_view_colors();
    var COLOR_VAR = "--link-color";
    var SOURCE_ATTR = "data-typ-src";
    var WIKILINK_PATTERN = /(?<!!)\[\[([^[\]]+?)\]\]/g;
    var MD_LINK_PATTERN = /(?<!!)\[([^\]\n]*)\]\((<[^>\n]+>|[^()\s]+(?:\([^()\s]*\)[^()\s]*)*)(?:\s+"[^"\n]*")?\)/g;
    function colorForTarget(plugin, target, sourcePath) {
      const linkpath = getLinkpath(target);
      if (!linkpath) return null;
      const file = plugin.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
      return colorForFile(plugin, file, "links");
    }
    function colorForLinktext(plugin, linktext, sourcePath) {
      return colorForTarget(plugin, linktext.split(/\\?\|/)[0].trim(), sourcePath);
    }
    function colorForMarkdownTarget(plugin, rawTarget, sourcePath) {
      const target = rawTarget.startsWith("<") ? rawTarget.slice(1, -1).trim() : rawTarget;
      const internal = target.startsWith("./") || target.startsWith("../") || !target.includes(":");
      if (!target || !internal) return null;
      let decoded;
      try {
        decoded = decodeURI(target);
      } catch {
        return null;
      }
      return colorForTarget(plugin, decoded.trim(), sourcePath);
    }
    function applyToAnchor(plugin, anchorEl) {
      const href = anchorEl.getAttribute("data-href");
      const color = plugin.settings.colorViews.links && href && !anchorEl.classList.contains("is-unresolved") ? colorForLinktext(plugin, href, anchorEl.getAttribute(SOURCE_ATTR) ?? "") : null;
      if (color) anchorEl.style.setProperty(COLOR_VAR, color);
      else anchorEl.style.removeProperty(COLOR_VAR);
    }
    function refreshRenderedLinks(plugin) {
      plugin.app.workspace.iterateAllLeaves((leaf) => {
        const sourcePath = leaf.view.file?.path ?? "";
        for (const anchorEl of leaf.view.containerEl.querySelectorAll(`.markdown-rendered a.internal-link:not([${SOURCE_ATTR}])`)) {
          anchorEl.setAttribute(SOURCE_ATTR, sourcePath);
        }
      });
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
        const sourcePath = view.state.field(editorInfoField, false)?.file?.path ?? "";
        const tree = syntaxTree(view.state);
        const builder = new RangeSetBuilder();
        const links = [];
        for (const { from, to } of view.visibleRanges) {
          const text = view.state.sliceDoc(from, to);
          WIKILINK_PATTERN.lastIndex = 0;
          for (let match; match = WIKILINK_PATTERN.exec(text); ) {
            const start = from + match.index;
            if (!tree.resolveInner(start + 2, 1).name.includes("hmd-internal-link")) continue;
            const color = colorForLinktext(plugin, match[1], sourcePath);
            if (color) links.push({ from: start, to: start + match[0].length, color });
          }
          MD_LINK_PATTERN.lastIndex = 0;
          for (let match; match = MD_LINK_PATTERN.exec(text); ) {
            const start = from + match.index;
            const targetNode = tree.resolveInner(start + match[1].length + 3, 1).name;
            if (!targetNode.includes("string_url") || targetNode.includes("formatting")) continue;
            const color = colorForMarkdownTarget(plugin, match[2], sourcePath);
            if (color) links.push({ from: start, to: start + match[0].length, color });
          }
        }
        links.sort((a, b) => a.from - b.from);
        let end = -1;
        for (const link of links) {
          if (link.from < end) continue;
          builder.add(link.from, link.to, decorationFor(link.color));
          end = link.to;
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
    function createEditorRefresher(plugin, component) {
      const run = () => {
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
      const schedule = coalesceFrame(run);
      component.register(schedule.cancel);
      return schedule;
    }
    function clearRenderedLinks(plugin) {
      for (const doc of allDocuments2(plugin.app)) {
        for (const anchorEl of doc.querySelectorAll(`a.internal-link[${SOURCE_ATTR}]`)) {
          anchorEl.style.removeProperty(COLOR_VAR);
        }
      }
    }
    function registerLinkColors2(plugin) {
      plugin.registerMarkdownPostProcessor((el, ctx) => {
        for (const anchorEl of el.querySelectorAll("a.internal-link")) {
          anchorEl.setAttribute(SOURCE_ATTR, ctx.sourcePath);
          applyToAnchor(plugin, anchorEl);
        }
      });
      const editorExtensions = [];
      plugin.registerEditorExtension(editorExtensions);
      const linkViewPlugin = Prec.lowest(buildLinkViewPlugin(plugin));
      return registerColorView(plugin, {
        key: "links",
        start: (component) => {
          editorExtensions.push(linkViewPlugin);
          plugin.app.workspace.updateOptions();
          component.register(() => {
            editorExtensions.length = 0;
            plugin.app.workspace.updateOptions();
          });
          const refreshEditors = createEditorRefresher(plugin, component);
          const refresh = () => {
            refreshRenderedLinks(plugin);
            refreshEditors();
          };
          component.registerEvent(plugin.typIndex.on("change", refresh));
          let running = true;
          component.register(() => running = false);
          plugin.app.workspace.onLayoutReady(() => {
            if (running) refreshRenderedLinks(plugin);
          });
          return refresh;
        },
        // Editor decorations go with the extension (see above), the inline
        // variables on rendered links don't.
        clear: () => clearRenderedLinks(plugin)
      });
    }
    module2.exports = { registerLinkColors: registerLinkColors2 };
  }
});

// src/property-link-colors.js
var require_property_link_colors = __commonJS({
  "src/property-link-colors.js"(exports2, module2) {
    var { Component } = require("obsidian");
    var { colorForLink, setInlineColor, allDocuments: allDocuments2 } = require_typ_colors();
    var { coalesceFrame } = require_typ_utils();
    var { registerColorView } = require_view_colors();
    var { watchEmbeds, findRenderChild } = require_note_embeds();
    var WATCH_CLASS = "typ-watch-property-links";
    var PROPERTY_LINK_SELECTOR = ".metadata-container .multi-select-pill-content.internal-link, .metadata-container .metadata-link-inner.internal-link";
    var PROPERTY_BLOCK_SELECTOR = ".metadata-container";
    function editorOf(app, editors, blockEl) {
      let editor = editors.get(blockEl);
      if (!editor) {
        editor = findRenderChild(app, (component) => component.containerEl === blockEl && typeof component.owner?.getFile === "function");
        if (editor) editors.set(blockEl, editor);
      }
      return editor ?? null;
    }
    function colorPropertyLink(plugin, editor, linkEl) {
      const sourcePath = editor?.owner.getFile()?.path ?? "";
      setInlineColor(linkEl, colorForLink(plugin, linkEl, sourcePath, "propertyLinks"));
    }
    function propertyLinks(plugin) {
      return [...allDocuments2(plugin.app)].flatMap((doc) => [...doc.querySelectorAll(PROPERTY_LINK_SELECTOR)]);
    }
    function insertedLinks(records) {
      const links = /* @__PURE__ */ new Set();
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (node.matches(PROPERTY_LINK_SELECTOR)) links.add(node);
          else for (const linkEl of node.querySelectorAll(PROPERTY_LINK_SELECTOR)) links.add(linkEl);
        }
      }
      return links;
    }
    function registerPropertyLinkColors2(plugin) {
      return registerColorView(plugin, {
        key: "propertyLinks",
        start: (component) => {
          const editors = /* @__PURE__ */ new WeakMap();
          const blocks = /* @__PURE__ */ new Map();
          const refresh = coalesceFrame(() => {
            for (const linkEl of propertyLinks(plugin)) {
              colorPropertyLink(plugin, editorOf(plugin.app, editors, linkEl.closest(PROPERTY_BLOCK_SELECTOR)), linkEl);
            }
          });
          component.register(refresh.cancel);
          const track = (editor) => {
            const child = new Component();
            const observer = new MutationObserver((records) => {
              for (const linkEl of insertedLinks(records)) colorPropertyLink(plugin, editor, linkEl);
            });
            observer.observe(editor.containerEl, { childList: true, subtree: true });
            child.register(() => {
              observer.disconnect();
              blocks.delete(editor);
            });
            blocks.set(editor, child);
            editor.addChild(child);
          };
          const onInserted = (linkEl) => {
            const editor = editorOf(plugin.app, editors, linkEl.closest(PROPERTY_BLOCK_SELECTOR));
            if (editor && !blocks.has(editor)) track(editor);
            colorPropertyLink(plugin, editor, linkEl);
          };
          watchEmbeds(plugin, component, { bodyClass: WATCH_CLASS, selector: PROPERTY_LINK_SELECTOR, onInserted });
          component.registerEvent(plugin.typIndex.on("change", refresh));
          component.register(() => {
            for (const [editor, child] of [...blocks]) editor.removeChild(child);
          });
          return refresh;
        },
        // Obsidian keeps no link elements out of the DOM - apart from a pill
        // being edited, put back on Escape - so the documents are all.
        clear: () => {
          for (const linkEl of propertyLinks(plugin)) setInlineColor(linkEl, null);
        }
      });
    }
    module2.exports = { registerPropertyLinkColors: registerPropertyLinkColors2, editorOf };
  }
});

// src/suggest-colors.js
var require_suggest_colors = __commonJS({
  "src/suggest-colors.js"(exports2, module2) {
    var { TFile, getLinkpath } = require("obsidian");
    var { colorForFile, setInlineColor, clearInlineColors: clearInlineColors2, allDocuments: allDocuments2 } = require_typ_colors();
    var { coalesceFrame } = require_typ_utils();
    var { registerColorView } = require_view_colors();
    var { editorOf } = require_property_link_colors();
    var KEYS = ["quickSwitcher", "linkSuggestions", "fileDialogs"];
    var TITLE_SELECTOR = ":scope > .suggestion-content > .suggestion-title";
    var NOTE_SELECTOR = ":scope > .suggestion-content > .suggestion-note";
    var FLAIR_SELECTOR = ":scope > .suggestion-aux > .suggestion-flair";
    var ROW_SELECTOR = ":scope > .suggestion-item";
    function colorRow(plugin, rowEl, file, viewKey) {
      const titleEl = rowEl?.querySelector(TITLE_SELECTOR);
      if (!titleEl) return;
      const color = file instanceof TFile && !rowEl.hasClass("mod-downranked") ? colorForFile(plugin, file, viewKey) : null;
      setInlineColor(titleEl, color);
    }
    function colorChooser(plugin, chooser, fileOf, viewKey) {
      const values = chooser.values ?? [];
      (chooser.suggestions ?? []).forEach((rowEl, index) => colorRow(plugin, rowEl, fileOf(values[index]), viewKey));
    }
    function rowParts(rowEl) {
      const flairEl = rowEl.querySelector(FLAIR_SELECTOR);
      return {
        titleText: rowEl.querySelector(TITLE_SELECTOR)?.textContent ?? null,
        noteText: rowEl.querySelector(NOTE_SELECTOR)?.textContent ?? null,
        flairEl,
        icon: flairEl?.querySelector(":scope > svg") ?? null
      };
    }
    function bookmarkFile(app, bookmarkPath) {
      const bookmarks = app.internalPlugins.getEnabledPluginById("bookmarks");
      if (!bookmarks) return null;
      const paths = /* @__PURE__ */ new Set();
      const visit = (items, prefix) => {
        for (const item of items ?? []) {
          if (item.type === "group") visit(item.items, `${prefix}${item.title}/`);
          else if (prefix + bookmarks.getItemTitle(item) === bookmarkPath) paths.add(item.type === "file" ? item.path : null);
        }
      };
      visit(bookmarks.items, "");
      const [path] = paths;
      return paths.size === 1 && path ? app.vault.getAbstractFileByPath(path) : null;
    }
    function switcherItemFile(app, item) {
      if (item?.type === "file" || item?.type === "alias") return item.file;
      if (item?.type === "bookmark" && item.item?.type === "file") return app.vault.getAbstractFileByPath(item.item.path);
      return null;
    }
    function dialogRowFile(app, rowEl) {
      if (!rowEl.matches(".suggestion-item.mod-complex[draggable='true']")) return null;
      const { titleText, noteText, flairEl, icon } = rowParts(rowEl);
      if (titleText === null || !flairEl) return null;
      if (noteText === null && flairEl.className === "suggestion-flair" && !flairEl.hasChildNodes()) {
        return app.vault.getAbstractFileByPath(`${titleText}.md`);
      }
      if (noteText !== null && icon?.classList.contains("lucide-forward")) return app.vault.getAbstractFileByPath(`${noteText}.md`);
      if (noteText !== null && icon?.classList.contains("lucide-bookmark")) return bookmarkFile(app, titleText);
      return null;
    }
    function linkItemFile(app, item, sourcePath) {
      if (item?.type === "file") return item.file;
      if (item?.type !== "alias") return null;
      return item.file ?? (item.path ? app.metadataCache.getFirstLinkpathDest(getLinkpath(item.path), sourcePath) : null);
    }
    function propertyQueryMode(inputEl) {
      const text = (inputEl instanceof HTMLInputElement ? inputEl.value : inputEl.textContent) ?? "";
      if (!text.startsWith("[[")) return "text";
      let query = text.slice(2);
      const end = query.indexOf("]]");
      if (end !== -1) query = query.slice(0, end);
      if (query.includes("|")) return "display";
      return /[#^]/.test(query) ? null : "file";
    }
    function propertyRowFile(app, rowEl, mode, sourcePath) {
      if (!rowEl.matches(".suggestion-item.mod-complex")) return null;
      const { titleText, noteText, flairEl, icon } = rowParts(rowEl);
      if (titleText === null || noteText === null) return null;
      const resolve = (href) => sourcePath === null ? null : app.metadataCache.getFirstLinkpathDest(getLinkpath(href), sourcePath);
      const isAlias = icon?.classList.contains("lucide-forward");
      if (mode === "file") {
        if (!flairEl) return app.vault.getAbstractFileByPath(`${noteText}${titleText}.md`);
        return isAlias ? app.vault.getAbstractFileByPath(`${noteText}.md`) : null;
      }
      if (mode === "display") return isAlias ? resolve(noteText) : null;
      if (mode === "text") {
        if (isAlias) return noteText.includes("#") ? null : resolve(noteText);
        return icon?.classList.contains("lucide-link") && !titleText.includes(" > ") ? resolve(titleText) : null;
      }
      return null;
    }
    function matchList(plugin, rootEl, editors) {
      const { app, settings } = plugin;
      const on = (key) => !!settings.colorViews[key];
      if (rootEl.hasClass("modal-container")) {
        const switcher = app.internalPlugins.plugins.switcher?.instance?.activeModal;
        if (switcher && switcher.containerEl === rootEl) {
          if (!on("quickSwitcher") || !switcher.chooser?.containerEl) return null;
          return {
            key: "quickSwitcher",
            itemsEl: switcher.chooser.containerEl,
            color: () => colorChooser(plugin, switcher.chooser, (item) => switcherItemFile(app, item), "quickSwitcher")
          };
        }
        const itemsEl2 = rootEl.querySelector(":scope > .prompt > .prompt-results");
        if (!itemsEl2 || !on("fileDialogs")) return null;
        return {
          key: "fileDialogs",
          itemsEl: itemsEl2,
          color: () => {
            for (const rowEl of itemsEl2.querySelectorAll(ROW_SELECTOR)) colorRow(plugin, rowEl, dialogRowFile(app, rowEl), "fileDialogs");
          }
        };
      }
      if (!rootEl.hasClass("suggestion-container") || !on("linkSuggestions")) return null;
      const linkSuggest = app.workspace.editorSuggest?.suggests?.find((suggest) => suggest.suggestManager && suggest.suggestEl === rootEl);
      if (linkSuggest) {
        if (!linkSuggest.suggestions?.containerEl) return null;
        return {
          key: "linkSuggestions",
          itemsEl: linkSuggest.suggestions.containerEl,
          color: () => {
            const sourcePath = linkSuggest.context?.file?.path ?? "";
            colorChooser(plugin, linkSuggest.suggestions, (item) => linkItemFile(app, item, sourcePath), "linkSuggestions");
          }
        };
      }
      const itemsEl = rootEl.hasClass("mod-property-value") ? rootEl.querySelector(":scope > .suggestion") : null;
      if (!itemsEl) return null;
      return {
        key: "linkSuggestions",
        itemsEl,
        color: () => {
          const inputEl = rootEl.ownerDocument.activeElement;
          const blockEl = inputEl?.closest(".metadata-container");
          const mode = blockEl ? propertyQueryMode(inputEl) : null;
          const editor = mode ? editorOf(app, editors, blockEl) : null;
          const sourcePath = editor ? editor.owner.getFile()?.path ?? "" : null;
          for (const rowEl of itemsEl.querySelectorAll(ROW_SELECTOR)) {
            colorRow(plugin, rowEl, mode ? propertyRowFile(app, rowEl, mode, sourcePath) : null, "linkSuggestions");
          }
        }
      };
    }
    function registerSuggestColors2(plugin) {
      const lists = /* @__PURE__ */ new Map();
      const clearList = (rootEl) => {
        const list = lists.get(rootEl);
        list.observer.disconnect();
        clearInlineColors2(list.itemsEl);
        lists.delete(rootEl);
      };
      return registerColorView(plugin, {
        enabled: () => KEYS.some((key) => plugin.settings.colorViews[key]),
        start: (component) => {
          const editors = /* @__PURE__ */ new WeakMap();
          const track = (rootEl) => {
            if (rootEl.nodeType !== Node.ELEMENT_NODE || lists.has(rootEl) || !rootEl.isConnected) return;
            const list = matchList(plugin, rootEl, editors);
            if (!list) return;
            list.observer = new MutationObserver(list.color);
            list.observer.observe(list.itemsEl, { childList: true });
            lists.set(rootEl, list);
            list.color();
          };
          const untrack = (rootEl) => {
            lists.get(rootEl)?.observer.disconnect();
            lists.delete(rootEl);
          };
          const bodyObserver = new MutationObserver((records) => {
            for (const record of records) {
              for (const node of record.removedNodes) untrack(node);
              for (const node of record.addedNodes) track(node);
            }
          });
          const watchDocument = (doc) => {
            bodyObserver.observe(doc.body, { childList: true });
            for (const el of doc.body.children) track(el);
          };
          for (const doc of allDocuments2(plugin.app)) watchDocument(doc);
          component.registerEvent(plugin.app.workspace.on("window-open", (workspaceWindow, win) => watchDocument(win.document)));
          component.register(() => {
            bodyObserver.disconnect();
            for (const list of lists.values()) list.observer.disconnect();
          });
          const refresh = coalesceFrame(() => {
            for (const [rootEl, list] of [...lists]) {
              if (plugin.settings.colorViews[list.key]) list.color();
              else clearList(rootEl);
            }
            for (const doc of allDocuments2(plugin.app)) {
              for (const el of doc.body.children) track(el);
            }
          });
          component.register(refresh.cancel);
          component.registerEvent(plugin.typIndex.on("change", refresh));
          return refresh;
        },
        // Observers are already disconnected (component unloaded).
        clear: () => {
          for (const rootEl of [...lists.keys()]) clearList(rootEl);
        }
      });
    }
    module2.exports = { registerSuggestColors: registerSuggestColors2 };
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
    var { compareTyps, subtypListMode, DEFAULT_SORT_ORDER: DEFAULT_SORT_ORDER2 } = require_typ_pane();
    var { nameColor, paintColorDot, subtypRowColor, appendSubtypPathPrefix } = require_typ_colors();
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
      // Search covers the name and, where shown in the row (showSubtyps), the
      // Subtyp names - not the description, which only explains the row.
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
        if (item.description) el.createSpan({ cls: "typ-picker-desc", text: item.description });
        el.createSpan({ cls: "typ-picker-count", text: String(item.count) });
      }
      // Name in the color of colorTyp (or of the Subtyp, see nameColor in
      // typ-colors.js) - as colored text or with a dot before it, depending on
      // the "TYP-Pane and -Picker" coloring setting. matches/start as in
      // highlight().
      renderColoredName(el, text, colorTyp, subtyp = null, matches = [], start = 0) {
        const { color, isDefault } = nameColor(this.plugin.settings, colorTyp, subtyp);
        const colorize = this.plugin.settings.colorViews.typList;
        if (!colorize) paintColorDot(el.createSpan({ cls: "typ-picker-dot" }), color, isDefault);
        const nameEl = el.createSpan({ cls: "typ-picker-name" });
        if (colorize) nameEl.style.color = color;
        highlight(nameEl, text, matches, start);
      }
      // "TYP (Subtyp 1, Subtyp 2)" - shows what lies below the TYP before the
      // Subtyp-Picker of the two-step flow comes. Each Subtyp in its own color,
      // brackets and commas muted; uncolored like the name when
      // "TYP-Pane and -Picker" coloring is off.
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
        if (!this.plugin.settings.colorViews.typList) el.createSpan({ cls: "typ-picker-dot typ-picker-dot-spacer" });
        const nameEl = el.createSpan({ cls: "typ-picker-name" });
        appendSubtypPathPrefix(nameEl, item.typ);
        const subtypEl = nameEl.createSpan();
        highlight(subtypEl, item.subtyp, match.match?.matches ?? []);
        const color = subtypRowColor(this.plugin.settings, item.typ, item.subtyp);
        if (color) subtypEl.style.color = color;
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
        const first = options.allNotes ? { typ: "all notes", count: plugin.typIndex.typCounts().counts.get(typ) ?? 0 } : { typ: "no Subtyp", count: plugin.typIndex.subtypBucket(typ).noSubtyp };
        items.unshift({ ...first, description: "", none: true });
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
      if (subtypListMode(plugin.settings) !== "rows") {
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
var { registerSearchColors, registerQueryBlockColors } = require_search_colors();
var { registerBasesColors } = require_bases_colors();
var { registerRecentFilesColors } = require_recent_files_colors();
var { registerBacklinkColors } = require_backlink_colors();
var { registerOutgoingLinkColors } = require_outgoing_link_colors();
var { registerBookmarksColors } = require_bookmark_colors();
var { registerActiveTitleColors } = require_active_title_colors();
var { registerTabTitleColors, registerViewHeaderColors } = require_header_colors();
var { registerLinkColors } = require_link_colors();
var { registerPropertyLinkColors } = require_property_link_colors();
var { registerSuggestColors } = require_suggest_colors();
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
      registerQueryBlockColors(this),
      registerBasesColors(this),
      registerRecentFilesColors(this),
      registerBacklinkColors(this),
      registerOutgoingLinkColors(this),
      registerBookmarksColors(this),
      registerActiveTitleColors(this),
      registerTabTitleColors(this),
      registerViewHeaderColors(this),
      registerLinkColors(this),
      registerPropertyLinkColors(this),
      registerSuggestColors(this),
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
  // "TYP / Subtyp" rows or both pickers in turn, following the TYP-List's
  // Subtyp display.
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
    if (this.settings.typListSecondary === "description") this.settings.typListSecondary = "none";
    delete this.settings.separateSubtypPicker;
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
