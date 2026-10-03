const { moment } = require("obsidian");

// A shortcut is a value computed only when a note is created. It is stored
// NEXT TO the property's frontmatter value, not in it: in
// settings.typShortcuts[TYP][key] for the TYP-Frontmatter, or in the shortcuts
// object of a Subtyp block (see subtyps.js):
//   { name: "today" }            - fixed token, resolved by the plugin
//   { name: "tp.<script>" }      - Templater script, only TYP.js can resolve it
//   { name: "tp.<script>", args: { folder: "Literatur", year: 2024 } }
//     - the same with arguments. The script declares the parameter names in
//       its @typ-shortcut marker (see shortcut-scripts.js); TYP.js passes the
//       object on as ctx.args. Fixed tokens never have arguments.
//
// Why next to the value: Obsidian picks a row's input from the property type
// in types.json. A date/number/checkbox property can't take a token like
// "{{today}}" at all, a stored one triggers the "Type mismatch" warning, and
// the list widget silently turns a string into an array on first edit. Kept
// apart, the value stays type-clean and the native widget untouched.
//
// The frontmatter value stays and serves as FALLBACK: if the script is missing
// or throws, TYP.js writes it instead of an empty value. A script that
// deliberately returns null/"" (e.g. ESC in a picker) is not a failure and
// leaves the property empty.

// Tokens the plugin resolves itself, without Templater - so getTypDefaults()
// fills them in. Resolved on each call, not when set, so "today" is the day
// the note is created.
const FIXED_SHORTCUTS = [
  {
    name: "today",
    description: "Heutiges Datum (JJJJ-MM-TT)",
    resolve: () => moment().format("YYYY-MM-DD"),
  },
  {
    name: "now",
    description: "Aktuelles Datum mit Uhrzeit (JJJJ-MM-TT HH:mm)",
    resolve: () => moment().format("YYYY-MM-DD HH:mm"),
  },
  {
    // The file's creation date (file.stat.ctime), not the call time; falls
    // back to now without a file.
    name: "created",
    description: "Erstellungsdatum der Datei (JJJJ-MM-TT)",
    resolve: (file) => moment(file?.stat?.ctime ?? Date.now()).format("YYYY-MM-DD"),
  },
];

// Script shortcuts carry this prefix so a script can never collide with a
// fixed token, not even a "today.js" in the script folder.
const SCRIPT_PREFIX = "tp.";

function findFixedShortcut(name) {
  return FIXED_SHORTCUTS.find((shortcut) => shortcut.name === name) ?? null;
}

// Script name of a "tp.<script>" shortcut, otherwise null. The script name is
// the file name without ".js", so umlauts, "-" and spaces are allowed.
function scriptNameOf(name) {
  return typeof name === "string" && name.startsWith(SCRIPT_PREFIX) ? name.slice(SCRIPT_PREFIX.length) : null;
}

function isScriptShortcut(record) {
  return scriptNameOf(record?.name) !== null;
}

// Display form in the property row (chip) and the picker: the bare name plus
// its arguments. The chip itself marks it as a shortcut, so no braces.
function shortcutLabel(record) {
  if (!record?.name) return "";
  const values = Object.values(record.args ?? {}).filter((value) => value !== undefined);
  return values.length > 0 ? `${record.name}: ${values.join(", ")}` : record.name;
}

// Converts a typed argument to the type it obviously means, so a script gets
// 5 as a number and true as a boolean (matters when the value lands in a
// number property). Deliberately these few cases instead of JSON.parse, which
// would fail on "Literatur". An empty field means "not set" (undefined) and
// drops out of the argument object, so "args.year ?? fallback" works.
function parseArgValue(raw) {
  const text = String(raw ?? "").trim();
  if (text === "") return undefined;
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  return text;
}

// Parameter names whose values the plugin or TYP.js already know; they are
// filled in at call time, not asked for:
//   newFile  the newly created note
//   ctx      the context { typ, subtyp, key, values, after, args }
//   key      the property the shortcut sits on, so a script like relation.js
//            gets the right one wherever the shortcut is used
// "tp" always comes first and needn't be declared; if it is, it is skipped.
const RESERVED_PARAMS = ["newFile", "ctx", "key"];

// Parameters that get an input field: everything not reserved. params === null
// (marker without parentheses) means the classic call, also without fields.
function inputParams(params) {
  return (params ?? []).filter((name) => name !== "tp" && !RESERVED_PARAMS.includes(name));
}

// Inputs (one string per parameter) to the stored argument object, in the
// declared order so shortcutLabel() shows them that way. Empty fields are left
// out.
function buildArgs(params, inputs) {
  const args = {};
  for (const name of inputParams(params)) {
    const value = parseArgValue(inputs[name]);
    if (value !== undefined) args[name] = value;
  }
  return args;
}

// Builds the arguments for f(tp, ...here) from the declared parameter list.
// Called from TYP.js, the only place that knows newFile and ctx.
//
// Without parentheses (params === null) it stays the classic f(tp, newFile,
// ctx). Otherwise each entry resolves to the passed value (reserved names) or
// the typed argument.
//
// A dotted name ("options.typ") is a FIELD of an object argument: all
// "options.*" collect into one object at the position of the first one. This
// serves scripts that take an options object without typing JSON. One level
// only - "a.b.c" gives a field literally named "b.c".
function resolveCallArgs(params, args, reserved = {}) {
  if (params === null || params === undefined) return [reserved.newFile, reserved.ctx];

  const callArgs = [];
  const objectIndex = new Map();
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
    if (value !== undefined) callArgs[objectIndex.get(base)][name.slice(dot + 1)] = value;
  }
  return callArgs;
}

// Whether types.json (or, if unset, the property's usage) declares a list.
// Then a resolved shortcut value is wrapped in a one-element array to match.
// Without app (tests) nothing is wrapped.
function isListProperty(app, key) {
  return app?.metadataTypeManager?.getTypeInfo?.(key)?.expected?.type === "multitext";
}

// Copy of frontmatter in which every key with a shortcut carries its value:
//   - fixed token -> resolved (wrapped for list properties),
//   - "tp.<script>" -> null; only Templater can resolve it, TYP.js gets these
//     keys from getTypShortcuts() and fills them in itself.
// Keys without a shortcut stay as they are. The stored value of a key WITH a
// shortcut is only overridden here, never deleted - it is the fallback.
function resolveShortcuts(frontmatter, shortcuts, { file, app } = {}) {
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

module.exports = {
  FIXED_SHORTCUTS,
  SCRIPT_PREFIX,
  findFixedShortcut,
  scriptNameOf,
  isScriptShortcut,
  shortcutLabel,
  parseArgValue,
  buildArgs,
  inputParams,
  resolveCallArgs,
  RESERVED_PARAMS,
  resolveShortcuts,
};
