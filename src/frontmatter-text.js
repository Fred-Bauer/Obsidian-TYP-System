const { parseYaml, stringifyYaml, getFrontMatterInfo } = require("obsidian");
const { setCanonicalProperty, deleteProperty } = require("./typ-index");
const { plural } = require("./typ-utils");

/* ============================================================
 * Comment-preserving frontmatter writes
 *
 * processFrontMatter parses the YAML into an object and serializes
 * it again: comments vanish and the formatting may change (quotes,
 * list style) - even when the callback changes nothing. The plugin's
 * own writes (sorting, rewriting TYP/SUBTYP on rename, merge and
 * registration) therefore work on the text instead and leave every
 * line they don't have to touch byte for byte as it was.
 *
 * Model: the block is cut into UNITS, one per top-level property:
 * its key line (column 0) plus every following line that belongs to
 * it - indented lines (nested values, block scalars `|`/`>`, indented
 * comments), `- ` items in column 0 (a list on the key's level), and
 * blank lines that are followed by such a line. Comment and blank
 * lines BETWEEN two units are the LEADING lines of the next one and
 * move with it ("a comment above a key belongs to that key"). Two
 * exceptions stay in place: a HEADER before the first key, as far as
 * it is separated from that key by a blank line, and a FOOTER of
 * comment and blank lines after the last unit. An inline comment
 * (`key: value # note`) is part of its key line.
 *
 * The cut is only trusted if it provably means the same as the whole
 * block: every unit must parse on its own to exactly one key, and the
 * units together must equal the parsed block (same keys, same order,
 * same values). That rules out what can't be cut safely - an alias to
 * an anchor in another unit, flow mappings or complex keys on the top
 * level, duplicate keys, a second document - without listing those
 * cases. After an edit the new block is parsed again and has to equal
 * the expected result, or nothing is written.
 *
 * A block that can't be cut (or an edit that can't be done without
 * dropping a comment, e.g. replacing a multi-line value that contains
 * one) falls back to the object model of processFrontMatter if the
 * block has no comments at all - nothing to lose then. With comments
 * the note is SKIPPED and the caller counts it in its notice.
 *
 * Line endings: every kept line keeps its own; new lines get the
 * block's line ending (the one after the opening `---`). A UTF-8 BOM
 * before the block is kept (getFrontMatterInfo alone wouldn't find
 * the block behind it).
 * ============================================================ */

// Thrown by TextDoc when an edit can't be done without losing a comment;
// caught by editFrontmatterText, which then decides between fallback and skip.
class UnsafeEdit extends Error {}

const BOM = "﻿";

// Lines including their line ending ("\n" or "\r\n"); the last one may lack it.
function splitLines(text) {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function stripEol(line) {
  return line.replace(/\r?\n$/, "");
}

const isBlank = (line) => /^[ \t]*$/.test(stripEol(line));
const isColumnZeroComment = (line) => line.startsWith("#");
// Starts a new top-level property: something in column 0 that is neither a
// comment nor a list item. Everything else on the key's level (a `- ` item,
// a closing bracket) is a following line; parsing decides whether it makes
// sense.
const isKeyLine = (line) => !/^[ \t#\r\n]/.test(line) && line !== "" && !/^-([ \t]|\r?$)/.test(stripEol(line));
// Deliberately generous: a `#` inside a block scalar or a quoted string counts
// too. It only decides between fallback and skip, and skipping is the safe side.
const mayHaveComment = (line) => /(^|[ \t])#/.test(stripEol(line));

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Deep equality of parsed YAML values, key order included.
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

// parseYaml without throwing; undefined = not parseable.
function tryParse(text) {
  try {
    return parseYaml(text);
  } catch {
    return undefined;
  }
}

// Where the frontmatter block sits in `content`, BOM-aware. eol is the
// line ending of the opening `---` (of the first line without a block).
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
    block: info.frontmatter,
  };
}

// Cuts the block text into header, units and footer, or returns null if the
// cut isn't provably equivalent to the whole block (see the top of the file).
// whole: the parsed block, so the caller doesn't parse it twice.
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
      // Content on the key's level before any key (a top-level list, say):
      // not a mapping we can cut.
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

  // Proof of the cut.
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

// The inline comment of a single-line unit ("   # note", with all the blanks
// before it, so an aligned comment stays aligned), or "" if there is none: the
// first `#` after a blank whose left part still parses to the same property.
// A `#` inside quotes fails that test.
function inlineComment(lineText, expected) {
  const pattern = /[ \t]#/g;
  let match;
  while ((match = pattern.exec(lineText))) {
    const left = lineText.slice(0, match.index).replace(/[ \t]+$/, "");
    if (sameValue(tryParse(left), expected)) return lineText.slice(left.length);
  }
  return "";
}

// Text model. Same interface as ObjectDoc, so a mutation runs unchanged on
// either.
class TextDoc {
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
        // Keep the line's own ending.
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
    if (reparsed === undefined || !sameValue(reparsed ?? {}, this.toObject())) return null;

    const { bom, eol } = location;
    if (!location.exists) {
      if (this.units.length === 0) return content;
      return bom + "---" + eol + block + "---" + eol + content.slice(bom.length);
    }
    if (block === location.block) return content;
    // Like processFrontMatter: without any property the block goes - unless
    // comments are left in it. (The block always starts the file.)
    if (block === "") return bom + content.slice(location.contentStart);
    return content.slice(0, location.from) + block + content.slice(location.to);
  }
}

// Fallback: the processFrontMatter object model, for blocks that can't be cut
// and have no comments. Tracks whether anything really changed, so an edit
// that changes nothing doesn't reformat the note (processFrontMatter always
// re-serializes).
class ObjectDoc {
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
    return this.has(key) ? this.object[key] : undefined;
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
    setCanonicalProperty(this.object, name, value);
    this.changed = true;
  }

  delete(name) {
    if (this.findKey(name) === undefined) return;
    deleteProperty(this.object, name);
    this.changed = true;
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
}

// The fallback write, processFrontMatter's own logic (parse, mutate, stringify
// in place of the block) - but on the content already read, so the decision
// and the write see the same text, with the BOM kept and the block's line
// ending used. null = skip.
function editAsObject(content, location, whole, mutate) {
  if (whole === undefined) return null;
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

// Pure core of editFrontmatter: content in, { status, content } out.
// status: "changed", "unchanged" or "skipped" (content then unchanged).
//
// mutate(doc) gets a TextDoc or, in the fallback, an ObjectDoc with the same
// interface. It must act on the note only through doc and be synchronous: it
// may run twice (text model first, object model if the text model gave up).
function editFrontmatterText(content, mutate) {
  const location = locateBlock(content);
  const block = location.exists ? location.block : "";
  const whole = tryParse(block);
  const hasComments = splitLines(block).some(mayHaveComment);

  const cut = whole === undefined ? null : cutBlock(block, whole);
  if (cut) {
    const doc = new TextDoc(location, cut);
    let result = null;
    try {
      mutate(doc);
      result = doc.render(content);
    } catch (error) {
      if (!(error instanceof UnsafeEdit)) throw error;
    }
    if (result !== null) return { status: result === content ? "unchanged" : "changed", content: result };
  }

  const result = editAsObject(content, location, whole, mutate);
  if (result === null) return { status: "skipped", content };
  if (result === content) return { status: "unchanged", content };
  // With comments the object model only tells whether there was anything to
  // do at all; writing its result would drop them.
  if (hasComments) return { status: "skipped", content };
  return { status: "changed", content: result };
}

// Edits the frontmatter of `file` with as little change to its text as
// possible (see the top of the file). One read and at most one write, through
// vault.process; an unchanged result writes nothing. Resolves to { status }.
//
// The one write path for the plugin's own frontmatter changes. Not for the
// Templater API (applyTypProperties, sortFrontmatter, placeProperty): those
// run inside the caller's processFrontMatter and work on its object.
async function editFrontmatter(app, file, mutate) {
  let status = "unchanged";
  await app.vault.process(file, (content) => {
    const result = editFrontmatterText(content, mutate);
    status = result.status;
    return result.content;
  });
  return { status };
}

// Appended to a notice when notes were skipped; "" for none.
// action: what couldn't be done, e.g. "re-sorted" or "updated".
function skippedText(skipped, action) {
  if (!skipped) return "";
  return ` ${plural(skipped, "note")} skipped (frontmatter can't be ${action} without losing comments).`;
}

module.exports = { editFrontmatter, editFrontmatterText, skippedText };
