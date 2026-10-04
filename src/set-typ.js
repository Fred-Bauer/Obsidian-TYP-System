const { Notice } = require("obsidian");
const { editFrontmatter, editFrontmatterText } = require("./frontmatter-text");
const { normalizeGlobalOrder, computeSortedKeys, orderedDefaultKeys } = require("./frontmatter-sort");
const { typKeyOf, TYP_PROPERTY, SUBTYP_PROPERTY } = require("./typ-index");

/* ============================================================
 * Setting a note's TYP without a Templater script
 *
 * The built-in counterpart of a Templater script TYP.js: TYP and
 * SUBTYP, the TYP-Frontmatter for missing or empty properties
 * (fixed shortcuts resolved, script shortcuts through Templater if
 * it is there), the empty leftovers of the previous TYP removed,
 * then sorted. Written comment-preserving through editFrontmatter.
 * ============================================================ */

// "Has a value" as in TYP.js: null, undefined and "" are empty.
const hasValue = (value) => value !== undefined && value !== null && value !== "";
const isPatch = (value) => value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;

// Value of `name` in a plain object, property names case-insensitive like
// Obsidian's (exact spelling first).
function valueOf(object, name) {
  if (!object) return undefined;
  if (Object.prototype.hasOwnProperty.call(object, name)) return object[name];
  const lower = name.toLowerCase();
  const key = Object.keys(object).find((k) => k.toLowerCase() === lower);
  return key === undefined ? undefined : object[key];
}

/* ------------------------------------------------------------
 * Templater without a template
 *
 * Templater builds its `tp` object only while it runs a template.
 * Its Dynamic Processor does it outside of one exactly like this
 * (Templater 2.25): a running config for the file in RunMode
 * DynamicProcessor (4), then the function object in FunctionsMode
 * USER_INTERNAL (1), which includes tp.user.<script>. Undocumented,
 * hence every piece is checked first and any failure means "no tp":
 * the script shortcuts then get their fallback values.
 *
 * The run is registered as a Templater task for the file
 * (start_templater_task/end_templater_task, as Templater does for
 * its own runs). Ending it fires "templater:all-templates-executed",
 * so a script's tp.hooks.on_all_templates_executed callback runs
 * after the frontmatter is written - like under TYP.js - instead of
 * lingering until some unrelated template finishes. While the task
 * is open, Templater's "trigger on new file creation" leaves the
 * file alone.
 * ------------------------------------------------------------ */
const RUN_MODE_DYNAMIC_PROCESSOR = 4;
const FUNCTIONS_MODE_USER_INTERNAL = 1;

function templaterOf(app) {
  const templater = app.plugins?.plugins?.["templater-obsidian"]?.templater;
  const usable =
    typeof templater?.create_running_config === "function" &&
    typeof templater?.functions_generator?.generate_object === "function" &&
    typeof templater?.start_templater_task === "function" &&
    typeof templater?.end_templater_task === "function";
  return usable ? templater : null;
}

// Resolves to { tp, end } or null. end() closes the Templater task and must
// be called once the run is done (also after an error).
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

/* ------------------------------------------------------------
 * Script shortcuts - the loop of TYP.js
 * ------------------------------------------------------------ */

// Fills the script shortcuts of `values` (the resolved TYP-Frontmatter, script
// keys null) in TYP-Frontmatter order. Same rules as TYP.js:
//   - the note already has a value: the script doesn't run, the default is
//     dropped (the note's value stays anyway)
//   - an earlier script filled the property through its returned object: its
//     value wins, this script doesn't run
//   - script missing or throwing: notice, the fallback value is used
//   - a plain object fills the shortcut's property from its entry and other
//     properties of the TYP (floating ones included) that are still empty
//   - null/"" returned on purpose (ESC in a picker) leaves the property empty
// ctx = { typ, subtyp, key, values, after, args }; after(fn) queues an action
// for after the write.
//
// Returns { afterActions, run }: run is the open Templater run (or null) for
// the caller to end after the write.
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

    // Built on the first script that has to run, so a TYP whose script
    // properties are all filled never touches Templater.
    if (run === undefined) run = await openTemplaterRun(app, file);
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
      new Notice(`Templater script "${name}" (property "${key}") not found – fallback value used.`);
    } else {
      try {
        const after = (fn) => afterActions.push({ name, fn });
        const ctx = { typ, subtyp, key, values, after, args: shortcut.args };
        const args = plugin.resolveShortcutArgs(shortcut.params, shortcut.args, { newFile: file, ctx, key });
        result = await script(run.tp, ...args);
      } catch (error) {
        failed = true;
        console.error(`TYP-System: Templater script "${name}" failed`, error);
        new Notice(`Templater script "${name}" (property "${key}") failed: ${error?.message ?? error} – fallback value used.`);
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
    new Notice(`Script shortcuts need Templater – fallback values used for: ${withoutTemplater.join(", ")}.`);
  }
  return { afterActions, run: run ?? null };
}

/* ------------------------------------------------------------
 * Writing
 * ------------------------------------------------------------ */

// Lower-case keys of a TYP's blocks (TYP-Frontmatter plus Subtyp block,
// floating keys included). Empty for a value that isn't a registered TYP.
function blockKeys(plugin, typ, subtyp) {
  if (!typ) return new Set();
  const { defaults } = plugin.collectBlocks(typ, subtyp, true);
  return new Set(Object.keys(defaults).map((key) => key.toLowerCase()));
}

// The mutation for editFrontmatter. Synchronous and acting only through doc
// (it may run twice, see frontmatter-text.js).
function applyTyp(plugin, doc, { typ, subtyp, values, globalOrder }) {
  // The previous TYP and Subtyp come from the note itself, not the index,
  // which may lag behind the file.
  const previousTyp = typKeyOf(doc.get(doc.findKey(TYP_PROPERTY) ?? TYP_PROPERTY));
  const previousSubtyp = typKeyOf(doc.get(doc.findKey(SUBTYP_PROPERTY) ?? SUBTYP_PROPERTY));

  // TYP and SUBTYP in canonical spelling, like applyTypProperties: a variant
  // such as "typ" is renamed in place, no Subtyp removes SUBTYP.
  doc.set(TYP_PROPERTY, typ);
  if (subtyp) doc.set(SUBTYP_PROPERTY, subtyp);
  else doc.delete(SUBTYP_PROPERTY);

  // TYP-Frontmatter only where the note has no value yet. A property the note
  // already has in another case keeps its spelling; an empty one stays as it
  // is unless there is a value to write (an empty default changes nothing).
  for (const [key, value] of Object.entries(values)) {
    const actual = doc.findKey(key);
    if (actual === undefined) doc.set(key, value);
    else if (!hasValue(doc.get(actual)) && hasValue(value)) doc.set(actual, value);
  }

  // Empty leftovers of the previous TYP: only properties of the previous TYP's
  // and Subtyp's blocks that the new TYP doesn't have (floating keys count as
  // having them). Every other empty property stays - it may be empty on purpose.
  const newKeys = blockKeys(plugin, typ, subtyp);
  const isSystemKey = (key) => [TYP_PROPERTY, SUBTYP_PROPERTY].some((name) => name.toLowerCase() === key);
  for (const key of blockKeys(plugin, previousTyp, previousSubtyp)) {
    if (newKeys.has(key) || isSystemKey(key)) continue;
    const actual = doc.findKey(key);
    if (actual !== undefined && !hasValue(doc.get(actual))) doc.delete(actual);
  }

  // Into sorting order, or new properties (SUBTYP in an existing note, say)
  // would end up last.
  const keys = doc.keys();
  const sorted = computeSortedKeys(keys, globalOrder, orderedDefaultKeys(plugin, typ, subtyp));
  if (!sorted.every((key, i) => key === keys[i])) doc.reorder(sorted);
}

// Sets TYP (and Subtyp, or none) of `file` with its TYP-Frontmatter. Resolves
// to the status of the write: "changed", "unchanged" or "skipped" (the
// frontmatter couldn't be changed without losing comments - nothing written,
// the queued after-actions don't run).
async function setTypOfFile(plugin, file, { typ, subtyp = null }) {
  const { app } = plugin;
  const values = plugin.getTypDefaults(typ, { file, subtyp });
  const allowedKeys = new Set(Object.keys(plugin.getTypDefaults(typ, { includeFloating: true, file, subtyp })));
  const existing = app.metadataCache.getFileCache(file)?.frontmatter ?? {};

  const { afterActions, run } = await resolveScriptShortcuts(plugin, file, { typ, subtyp, values, allowedKeys, existing });
  try {
    // Read after the scripts: one of them may have waited for input for a while.
    const globalOrder = normalizeGlobalOrder(plugin.settings.globalPropertyOrder);
    const { status } = await editFrontmatter(app, file, (doc) => applyTyp(plugin, doc, { typ, subtyp, values, globalOrder }));
    if (status === "skipped") return status;

    // Queued by the scripts through ctx.after - only now, after the write,
    // and one after the other.
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

const typLabel = (typ, subtyp) => (subtyp ? `${typ} / ${subtyp}` : typ);

// Command "Set TYP of active note".
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

// A new empty note named like Obsidian's "New note" does ("Untitled",
// "Untitled 1", ...) in `folder`, with `content`. Obsidian's own
// createNewMarkdownFile (undocumented) picks the name in Obsidian's language;
// without it the English name is used.
async function createUntitledNote(app, folder, content) {
  if (typeof app.fileManager.createNewMarkdownFile === "function") {
    return app.fileManager.createNewMarkdownFile(folder, undefined, content);
  }
  const prefix = folder.isRoot() ? "" : folder.path + "/";
  let path = `${prefix}Untitled.md`;
  for (let i = 1; app.vault.getAbstractFileByPath(path); i++) path = `${prefix}Untitled ${i}.md`;
  return app.vault.create(path, content);
}

// Command "New note with TYP": TYP and Subtyp first, then the note in the
// folder of Obsidian's "Default location for new notes", the same TYP logic as
// for the active note, and finally it opens with its title selected for
// renaming - like Obsidian's "New note".
async function createNoteWithTyp(plugin) {
  const choice = await plugin.pickTypAndSubtyp({ includeManualOff: false });
  if (!choice) return;
  const { app } = plugin;

  const folder = app.fileManager.getNewFileParent(app.workspace.getActiveFile()?.path ?? "");
  // Created with TYP (and SUBTYP) already in place instead of empty: a
  // Templater "trigger on new file creation" that runs TYP.js with
  // skipIfNotEmpty then leaves the note alone instead of opening its picker.
  const initial = editFrontmatterText("", (doc) => {
    doc.set(TYP_PROPERTY, choice.typ);
    if (choice.subtyp) doc.set(SUBTYP_PROPERTY, choice.subtyp);
  }).content;
  const file = await createUntitledNote(app, folder, initial);

  try {
    await setTypOfFile(plugin, file, choice);
  } finally {
    // Opened even if something failed: the note exists either way.
    await app.workspace.getLeaf("tab").openFile(file, { active: true, state: { mode: "source" }, eState: { rename: "all" } });
  }
}

module.exports = { setTypOfFile, setTypOfActiveNote, createNoteWithTyp };
