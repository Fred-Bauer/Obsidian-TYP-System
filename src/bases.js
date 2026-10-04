const { Notice, TFile, stringifyYaml } = require("obsidian");
const { getSubtypNames } = require("./subtyps");
const { normalizeGlobalOrder, TYP_PROPERTY, SUBTYP_PROPERTY } = require("./frontmatter-sort");
const { askColumnOptions, askRemovals } = require("./base-dialogs");
const { plural } = require("./typ-utils");

/* ============================================================
 * Bases from a TYP
 * Creates a .base in the vault root for a TYP (or a Subtyp name):
 * a TYP filter, one table view per Subtyp, and columns from the
 * TYP-Frontmatter plus the global property order. The second
 * command brings the columns of an existing view up to date.
 *
 * Writes only through Obsidian's own Bases API and serialization
 * (see appendViews), never through self-parsed YAML - formula
 * blocks and special keys wouldn't reliably survive the round trip.
 * ============================================================ */

// View property ids are fully qualified in memory ("note.Titel", "file.name",
// "formula.X") but stored without "note." in the file. cfg.setOrder() wants
// the qualified form, a view object built for the file the short one -
// serializeId() converts.
const FILE_NAME_ID = "file.name";
const NOTE_PREFIX = "note.";
const TAGS_PROPERTY = "tags";
const BASE_EXTENSION = "base";
// Id of the Bases core plugin (as in .obsidian/core-plugins.json).
const BASES_PLUGIN_ID = "bases";

// Without the Bases core plugin a .base file can't be opened, so creating one
// would only leave a dead file behind (see "create-base-for-typ" in
// commands.js).
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

// A filter expression the way Bases writes it: TYP == "MEDIA". JSON.stringify
// quotes correctly even if the name contains a quote.
function equalsFilter(property, value) {
  return `${property} == ${JSON.stringify(String(value))}`;
}

/* --- Reading TYP/Subtyp from an existing filter --------------------------
 * A generated view carries its TYP in the root or view filter; the update
 * command reads it from there instead of asking. Only unambiguous filters
 * count: a pure AND with exactly one TYP or SUBTYP comparison. An OR group
 * doesn't necessarily restrict, and a second, different value contradicts -
 * both give null and the command asks instead (see updateActiveView).
 * --------------------------------------------------------------------- */
const EQUALS_PATTERN = new RegExp(`^\\s*(${TYP_PROPERTY}|${SUBTYP_PROPERTY})\\s*==\\s*(.+?)\\s*$`, "i");

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
  // AND only: an OR/NOT group says nothing reliable about the TYP of the hits.
  if (node.and) collectEquals(node.and, found);
}

function readTarget(...filterGroups) {
  const found = { [TYP_PROPERTY]: new Set(), [SUBTYP_PROPERTY]: new Set() };
  for (const group of filterGroups) collectEquals(group, found);
  const typs = [...found[TYP_PROPERTY]];
  const subtyps = [...found[SUBTYP_PROPERTY]];
  if (typs.length > 1 || subtyps.length > 1) return null;
  if (typs.length === 0 && subtyps.length === 0) return null;
  return { typ: typs[0] ?? null, subtyp: subtyps[0] ?? null };
}

/* --- Columns of a target ------------------------------------------------- */

// TYP and SUBTYP never become columns (filter and grouping already show
// them), nor does the editor's blank row.
function isSystemKey(key) {
  return key === "" || sameId(key, TYP_PROPERTY) || sameId(key, SUBTYP_PROPERTY);
}

// A block's properties in stored order, via collectBlocks() (main.js), so the
// same rules apply: the Subtyp block follows the TYP-Frontmatter, a key in both
// keeps the TYP-Frontmatter position, and the Subtyp's floating flag wins - a
// Subtyp can keep a standard property out of its view that way.
function blockKeys(plugin, typ, subtyp, includeFloating) {
  const { defaults } = plugin.collectBlocks(typ, subtyp, includeFloating);
  return Object.keys(defaults).filter((key) => !isSystemKey(key));
}

// Every TYP that has a Subtyp of this name, in TYP-List order. The same
// Subtyp name may exist under several TYP entries; a standalone Subtyp Base
// filters by SUBTYP only and so shows all of them.
function typsForSubtyp(plugin, subtyp) {
  return plugin.settings.typs.filter((typ) => getSubtypNames(plugin.settings, typ).includes(subtyp));
}

// A target is { typ, subtyp }:
//   { typ, subtyp: null }  - the TYP itself
//   { typ, subtyp }        - a Subtyp within its TYP
//   { typ: null, subtyp }  - a Subtyp name not bound to a TYP (standalone
//                            Subtyp Base, columns merged across TYP entries)
function targetKeys(plugin, target, options) {
  const seen = new Set();
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
  // Only for the TYP view: in a Subtyp view the other blocks would stay empty,
  // since a note has at most one SUBTYP. Keys already in main drop out via
  // "seen".
  if (options.allSubtyps && !target.subtyp) {
    for (const subtyp of getSubtypNames(plugin.settings, target.typ)) {
      add(others, blockKeys(plugin, target.typ, subtyp, options.floating));
    }
  }
  return { main, others };
}

// The column options a view's current columns suggest, to preset the column
// dialog when updating (currentIds qualified, "note.x"). Without this the
// dialog would start all off and the removal dialog would offer exactly the
// columns chosen when the Base was created.
//   tags       - the tags column exists
//   floating   - a floating property of the target exists as a column
//   allSubtyps - (TYP target only) a property of another Subtyp block exists
//                as a column
// A heuristic, on purpose: the view keeps no record of the options it was
// built with.
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
    tags: hasColumn(TAGS_PROPERTY),
  };
  if (target.typ && !target.subtyp) {
    options.allSubtyps = targetKeys(plugin, target, { floating: true, allSubtyps: true }).others.some(hasColumn);
  }
  return options;
}

// The final column list: file.name first, then the global property order as
// the frame. Its placeholders mean here:
//   "typ"                     - TYP-Frontmatter plus the target's Subtyp block
//   "other"                   - the properties of the other Subtyp blocks
//   "typValue"/"subtypValue"  - skipped, TYP/SUBTYP are no columns
// Of the pinned properties only tags counts (and only when checked):
// cssclasses or aliases make no sense as columns of an overview table.
function columnIds(plugin, target, options) {
  const { main, others } = targetKeys(plugin, target, options);
  const ids = [];
  const seen = new Set();
  const push = (id) => {
    const lower = id.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    ids.push(id);
  };

  push(FILE_NAME_ID);
  let tagsPlaced = false;
  for (const entry of normalizeGlobalOrder(plugin.settings.globalPropertyOrder)) {
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
  // Safety net: if tags isn't in the global order, it still goes last.
  if (options.tags && !tagsPlaced) push(noteId(TAGS_PROPERTY));
  return ids;
}

/* --- Views of a target --------------------------------------------------- */

// scoped: whether each view must carry its full filter. In a new Base the TYP
// sits in the root filter and Subtyp views only add SUBTYP. Views appended to
// an existing Base leave its root filter alone and filter themselves.
function targetViews(plugin, target, options, { scoped }) {
  if (!target.typ) {
    const view = {
      type: "table",
      name: target.subtyp,
      order: columnIds(plugin, target, options),
    };
    if (scoped) view.filters = { and: [equalsFilter(SUBTYP_PROPERTY, target.subtyp)] };
    // Several TYP entries with this Subtyp name: grouping separates them
    // without a view per TYP.
    if (typsForSubtyp(plugin, target.subtyp).length > 1) {
      view.groupBy = { property: noteId(TYP_PROPERTY), direction: "ASC" };
    }
    return [view];
  }

  const typ = target.typ;
  const subtyps = getSubtypNames(plugin.settings, typ);
  const main = {
    type: "table",
    name: typ,
    order: columnIds(plugin, { typ, subtyp: null }, options),
  };
  if (scoped) main.filters = { and: [equalsFilter(TYP_PROPERTY, typ)] };
  // Without any Subtyp, grouping by an always-empty property would only give
  // one "no value" group.
  if (subtyps.length > 0) main.groupBy = { property: noteId(SUBTYP_PROPERTY), direction: "ASC" };

  const views = [main];
  for (const subtyp of subtyps) {
    views.push({
      type: "table",
      name: subtyp,
      // allSubtyps is always off in a Subtyp view (see targetKeys).
      order: columnIds(plugin, { typ, subtyp }, { ...options, allSubtyps: false }),
      filters: {
        and: scoped
          ? [equalsFilter(TYP_PROPERTY, typ), equalsFilter(SUBTYP_PROPERTY, subtyp)]
          : [equalsFilter(SUBTYP_PROPERTY, subtyp)],
      },
    });
  }
  return views;
}

// A view object as it appears in the file: without "note." and with the key
// order Bases itself writes.
function serializeView(view) {
  const out = { type: view.type, name: view.name };
  if (view.filters) out.filters = view.filters;
  if (view.order) out.order = view.order.map(serializeId);
  if (view.groupBy) {
    out.groupBy = { property: serializeId(view.groupBy.property), direction: view.groupBy.direction };
  }
  return out;
}

/* --- Opening and writing the file ---------------------------------------- */

function waitFor(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// Opens the Base and waits until its query is parsed; only then can it be
// read and written. Reuses a tab that already shows the file.
async function openBase(app, file) {
  const open = app.workspace.getLeavesOfType("bases").find((leaf) => leaf.view?.file?.path === file.path);
  const leaf = open ?? app.workspace.getLeaf("tab");
  if (open) app.workspace.revealLeaf(leaf);
  else await leaf.openFile(file, { active: true });
  for (let attempt = 0; attempt < 40 && !leaf.view?.query; attempt++) await waitFor(25);
  return leaf.view?.query ? leaf.view : null;
}

// Appends views to an existing Base. getSerializable() returns exactly what
// Bases writes when it saves (verified: the round trip reproduces existing
// files byte for byte, formula blocks and special keys included); only the
// views list is touched.
//
// vault.process rather than vault.modify, as Obsidian recommends for changes
// to a file that may be open: it writes atomically. The callback ignores the
// file text on purpose - data comes from the parsed query, which the open
// Base keeps in step with the file.
async function appendViews(app, view, views) {
  const data = view.query.getSerializable();
  data.views = [...(data.views ?? []), ...views.map(serializeView)];
  await app.vault.process(view.file, () => stringifyYaml(data));
}

/* --- Command: Create Base for TYP ---------------------------------------- */

// Files and folders of the vault root whose name matches name ignoring case
// but not exactly. getAbstractFileByPath() is case-sensitive, while Windows
// and macOS treat "BUCH.base" and "Buch.base" as the same file - and Sync
// would collide them on every other device.
function caseVariants(app, name) {
  const lower = name.toLowerCase();
  return app.vault.getRoot().children.filter((file) => file.name !== name && file.name.toLowerCase() === lower);
}

// <TYP>.base, or <Subtyp>.base for a standalone Subtyp Base. A TYP BUCH and
// a Subtyp Buch would share one file on Windows, so the Subtyp Base gets
// " (Subtyp)" - but only when there actually is a clash: a TYP of that name
// (registered, whether or not its Base exists yet) or a root .base file whose
// name differs only in case. Then only the new name counts, with no fallback
// to "Buch.base" - that one belongs to the TYP.
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
    new Notice(`"${path}" is not a file – Base not created.`);
    return;
  }

  if (!existing) {
    const views = targetViews(plugin, target, options, { scoped: false });
    const root = target.typ
      ? { and: [equalsFilter(TYP_PROPERTY, target.typ)] }
      : { and: [equalsFilter(SUBTYP_PROPERTY, target.subtyp)] };
    const file = await app.vault.create(path, stringifyYaml({ filters: root, views: views.map(serializeView) }));
    await openBase(app, file);
    new Notice(`Created ${path} with ${plural(views.length, "view")}.`);
    return;
  }

  // The file exists: add what is missing. A view with the same name stays
  // untouched - it may be hand-made, and overwriting it would be a silent loss.
  const view = await openBase(app, existing);
  if (!view) {
    new Notice(`Couldn't read ${path} – Base not updated.`);
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
  // includeManualOff: a Base is especially useful for TYP entries that aren't
  // set by hand (KONTAKT, MEDIA, EXTERN). Unregistered values are left out -
  // they have no TYP-Frontmatter and so no columns.
  const choice = await plugin.pickTypAndSubtyp({ includeManualOff: true });
  if (!choice) return;

  // A Subtyp picked here means the standalone Subtyp Base: it filters by
  // SUBTYP only and merges the columns of every TYP with that Subtyp name.
  const target = choice.subtyp ? { typ: null, subtyp: choice.subtyp } : { typ: choice.typ, subtyp: null };
  await createBaseFor(plugin, target);
}

// The command after its picker, also the entry with a fixed target (context
// menu of the TYP-List): column options, then create or complete the file.
async function createBaseFor(plugin, target) {
  const path = basePath(plugin, target);
  // Only a file in a different case exists (an old Subtyp Base "Buch.base"
  // when creating "BUCH.base", say): creating would fail on Windows, and
  // writing into it would fill someone else's Base. Leave the decision to the
  // user - checked before the dialog, so no options are chosen in vain.
  const variant = plugin.app.vault.getAbstractFileByPath(path) ? null : caseVariants(plugin.app, path)[0];
  if (variant) {
    new Notice(`"${variant.name}" already exists in a different case – rename or delete it first.`);
    return;
  }

  const options = await askColumnOptions(plugin, target, (current) => columnIds(plugin, target, current));
  if (!options) return;
  await createBase(plugin, target, path, options);
}

/* --- Command: Update columns of Base view -------------------------------- */

// The most recent leaf of the main area, not workspace.activeLeaf (deprecated):
// that is also a sidebar leaf, e.g. the TYP-Pane when it was clicked last.
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
  // Written only once every dialog is confirmed: cancelling must leave the
  // view exactly as it was, filter included.
  let pendingFilter = null;
  if (!target) {
    // No unambiguous TYP in the filter (hand-written OR group, no filter at
    // all): ask, and store the answer as a filter so the next run reads it.
    const choice = await plugin.pickTypAndSubtyp({ includeManualOff: true });
    if (!choice) return;
    target = { typ: choice.typ, subtyp: choice.subtyp };
    const and = [equalsFilter(TYP_PROPERTY, choice.typ)];
    if (choice.subtyp) and.push(equalsFilter(SUBTYP_PROPERTY, choice.subtyp));
    pendingFilter = { and };
  }

  // Preset from the view's columns, so the options it was built with aren't
  // offered for removal.
  const initial = optionsFromColumns(plugin, target, Array.isArray(cfg.order) ? cfg.order : []);
  const options = await askColumnOptions(plugin, target, (current) => columnIds(plugin, target, current), initial);
  if (!options) return;

  const desired = columnIds(plugin, target, options);
  const desiredLower = new Set(desired.map((id) => id.toLowerCase()));
  // A view without its own order shows every property - nothing to remove,
  // the generated list simply takes its place.
  const current = Array.isArray(cfg.order) ? [...cfg.order] : [];
  const extras = current.filter((id) => !desiredLower.has(id.toLowerCase()));

  let kept = [];
  if (extras.length > 0) {
    const removals = await askRemovals(plugin, extras, cfg.name);
    if (!removals) return;
    kept = extras.filter((id) => !removals.has(id));
  }

  // Kept columns stay up front, right after file.name: hand-added ones
  // (formula columns, say) shouldn't slide to the end.
  const newOrder = [
    FILE_NAME_ID,
    ...kept.filter((id) => !sameId(id, FILE_NAME_ID)),
    ...desired.filter((id) => !sameId(id, FILE_NAME_ID)),
  ];

  // Filter before order, as before: both change the same parsed query, each
  // call saves it.
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

module.exports = {
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
  targetViews,
};
