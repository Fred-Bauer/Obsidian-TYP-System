const { FuzzySuggestModal, Notice, prepareFuzzySearch } = require("obsidian");
const { compareTyps, DEFAULT_SORT_ORDER } = require("./typ-pane");
const { nameColor, paintColorDot } = require("./typ-colors");

// Native replacement for Templater's tp.system.suggester when choosing a TYP
// (see _obsidian/templater-scripts/TYP.js), built on Obsidian's
// FuzzySuggestModal like Templater's own, but showing color or dot,
// description and note count per row. Unregistered entries are muted, as in
// the TYP-List.
class TypPickerModal extends FuzzySuggestModal {
  constructor(app, plugin, items, resolve) {
    super(app);
    this.plugin = plugin;
    this.items = items;
    this.resolve = resolve;
    this.chosen = false;
    this.setPlaceholder("ESC to cancel");
  }

  getItems() {
    return this.items;
  }

  // Search also covers the description and, where shown in the row
  // (showSubtyps), the Subtyp names: what you see you expect to be able to type.
  getItemText(item) {
    return [item.typ, item.subtyps?.join(" "), item.description].filter(Boolean).join(" ");
  }

  renderSuggestion(match, el) {
    const item = match.item;
    el.addClass("typ-picker-suggestion");
    if (item.unregistered) el.addClass("typ-picker-unregistered");

    if (item.unregistered) {
      el.createSpan({ cls: "typ-picker-name", text: item.typ });
    } else {
      this.renderColoredName(el, item.typ, item.typ);
    }

    if (item.subtyps?.length) this.renderSubtypPreview(el, item);

    if (item.description) {
      el.createSpan({ cls: "typ-picker-desc", text: item.description });
    }

    el.createSpan({ cls: "typ-picker-count", text: String(item.count) });
  }

  // Name in the color of colorTyp (or of the Subtyp, see nameColor in
  // typ-colors.js) - as colored text or with a dot before it, depending on
  // the "TYP-Pane" coloring setting.
  renderColoredName(el, text, colorTyp, subtyp = null) {
    const { color, isDefault } = nameColor(this.plugin.settings, colorTyp, subtyp);
    if (this.plugin.settings.colorViews.typList) {
      el.createSpan({ cls: "typ-picker-name", text }).style.color = color;
    } else {
      paintColorDot(el.createSpan({ cls: "typ-picker-dot" }), color, isDefault);
      el.createSpan({ cls: "typ-picker-name", text });
    }
  }

  // "TYP (Subtyp 1, Subtyp 2)" - shows what lies below the TYP before the
  // separate Subtyp-Picker comes. Each Subtyp in its own color, brackets and
  // commas muted; uncolored like the name when "TYP-Pane" coloring is off.
  renderSubtypPreview(el, item) {
    const colorize = this.plugin.settings.colorViews.typList;
    const wrap = el.createSpan({ cls: "typ-picker-subtyps" });
    wrap.appendText("(");
    item.subtyps.forEach((subtyp, index) => {
      if (index > 0) wrap.appendText(", ");
      const span = wrap.createSpan({ text: subtyp });
      if (colorize) span.style.color = nameColor(this.plugin.settings, item.typ, subtyp).color;
    });
    wrap.appendText(")");
  }

  // Obsidian's selectSuggestion() calls close() BEFORE onChooseItem(). Set
  // "chosen" any later and onClose() resolves with null first - a promise only
  // resolves once, so every choice would come back as null.
  selectSuggestion(item, evt) {
    this.chosen = true;
    // What was typed when choosing; the Subtyp-Picker sorts by it (see
    // pickTypEntry/sortByQuery).
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
}

// Picks a Subtyp for an already chosen TYP (see pickSubtyp). Like
// TypPickerModal, plus a first row "TYP (no Subtyp)" (item.none). ESC resolves
// with null, and TYP.js goes back to the TYP choice. query is the search from
// the TYP-Picker that pre-sorts the list.
class SubtypPickerModal extends TypPickerModal {
  constructor(app, plugin, typ, items, resolve, query = "") {
    super(app, plugin, items, resolve);
    this.typ = typ;
    this.setPlaceholder(`Subtyp for ${typ} – ESC to go back`);
    this.items = sortByQuery(items, query, (item) => this.getItemText(item));
  }

  // The "no Subtyp" row is also found by the TYP name it shows, so "ORGA"
  // typed in the TYP-Picker brings it back to the top.
  getItemText(item) {
    return item.none ? `${this.typ} ${item.typ}` : super.getItemText(item);
  }

  renderSuggestion(match, el) {
    const item = match.item;
    el.addClass("typ-picker-suggestion");
    if (item.none) {
      // "ORGA (no Subtyp)": the TYP in its color, the suffix in normal text
      // color rather than muted - it is a real choice, not a grayed-out
      // non-choice, and it stands apart from the Subtyp rows below.
      this.renderColoredName(el, this.typ, this.typ);
      el.createSpan({ cls: "typ-picker-none", text: `(${item.typ})` });
    } else {
      this.renderColoredName(el, item.typ, this.typ, item.typ);
    }
    el.createSpan({ cls: "typ-picker-count", text: String(item.count) });
  }

  onChooseItem(item) {
    this.resolve(item.none ? "" : item.typ);
  }
}

// TYP-Picker with each Subtyp indented below its TYP (the default while
// "Separate Subtyp-Picker" is off, see pickTypAndSubtyp). The TYP row itself
// means "no Subtyp". Search works per group so a Subtyp never appears without
// its TYP: a TYP match keeps all its Subtyps, a Subtyp match keeps that Subtyp
// with its TYP. Groups sort by their best match; within a group block order
// stays.
class TypSubtypPickerModal extends TypPickerModal {
  constructor(app, plugin, groups, resolve) {
    super(app, plugin, groups.map((group) => group.item), resolve);
    this.groups = groups;
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
        rows: [{ item, match: typMatch ?? noMatch }, ...subtypMatches.map((entry) => ({ item: entry.item, match: entry.match ?? noMatch }))],
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
    this.renderColoredName(el, item.subtyp, item.typ, item.subtyp);
    el.createSpan({ cls: "typ-picker-count", text: String(item.count) });
  }

  onChooseItem(item) {
    this.resolve({ typ: item.typ, subtyp: item.subtyp ?? null });
  }
}

// Initial order of a picker list given an already typed query (from the
// TYP-Picker, see pickTypEntry): matches first by score, the rest after in
// unchanged order. If nothing matches (a description was typed, say) the
// list stays as it was. Typing in the picker itself uses Obsidian's search.
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

// For TYP.js: opens the Subtyp-Picker if the TYP has at least one registered
// Subtyp (in block order). query pre-sorts the list: typing "Lehrveranstaltung"
// to reach ORGA meant that Subtyp, which then sits on top - Enter suffices.
// options as in getSubtyps: Subtyps that aren't manually creatable are left
// out by default, like such TYP entries before. Resolves with
//  - the chosen Subtyp,
//  - "" for "no Subtyp" (the first row without a query) - or right away,
//    without a picker, if the TYP has no selectable Subtyp,
//  - null on ESC (TYP.js goes back to the TYP choice).
function pickSubtyp(app, plugin, typ, query = "", options = {}) {
  return new Promise((resolve) => {
    const items = plugin.getSubtyps(typ, options).map(({ subtyp, count }) => ({ typ: subtyp, description: "", count }));
    if (items.length === 0) {
      resolve("");
      return;
    }
    // "no Subtyp" first: Enter picks it without typing, and it is more common
    // than any single Subtyp.
    const noneCount = plugin.typIndex.subtypBucket(typ).noSubtyp;
    items.unshift({ typ: "no Subtyp", description: "", count: noneCount, none: true });
    new SubtypPickerModal(app, plugin, typ, items, resolve, query).open();
  });
}

// TYP values that occur in notes but aren't in settings.typs, like the
// unregistered rows of the TYP-List. Lists and padded values (see isCleanKey)
// are left out: the chosen value is written into a new note and shouldn't be a
// cleanup case there.
function unregisteredItems(app, plugin) {
  const registered = new Set(plugin.settings.typs);
  const { counts } = plugin.typIndex.typCounts();
  const sortOrder = plugin.settings.typSortOrder ?? DEFAULT_SORT_ORDER;
  return [...counts.keys()]
    .filter((typ) => !registered.has(typ) && plugin.typIndex.isCleanKey(typ))
    .sort((a, b) => compareTyps(sortOrder, a, b, counts, plugin.settings.typColors))
    .map((typ) => ({ typ, description: "", count: counts.get(typ) ?? 0, unregistered: true }));
}

// Picks a single TYP, for TYP.js and everywhere in the plugin. includeManualOff
// as in getTyps(); includeUnregistered adds values that occur in notes but
// aren't registered (muted). showSubtyps puts the Subtyp names after the TYP
// name, for the separate flow where the Subtyp-Picker comes afterwards.
// Resolves with the TYP, or null on cancel or if there is nothing to show.
function pickTyp(app, plugin, options = {}) {
  return pickTypEntry(app, plugin, options).then((entry) => entry?.typ ?? null);
}

// Like pickTyp, but resolves with { typ, query }, query being what was typed.
// Only for pickTypAndSubtyp, which passes it on to the Subtyp-Picker.
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

// Shared TYP list for pickTyp/pickTypAndSubtyp; null plus a notice if there is
// nothing to show with these options.
function typItems(app, plugin, { includeManualOff = false, includeUnregistered = false, showSubtyps = false } = {}) {
  const items = plugin.getTyps({ includeManualOff }).map((item) => ({ ...item, unregistered: false }));
  if (includeUnregistered) items.push(...unregisteredItems(app, plugin));
  // Only registered TYP entries have Subtyps; the others stay unchanged.
  if (showSubtyps) {
    for (const item of items) item.subtyps = plugin.getSubtyps(item.typ, { includeManualOff }).map(({ subtyp }) => subtyp);
  }
  if (items.length > 0) return items;
  new Notice("No TYP available.");
  return null;
}

// For TYP.js: TYP and Subtyp in one go. With separateSubtypPicker off, one
// picker with each Subtyp indented below its TYP; with it on, first the
// TYP-Picker (Subtyp names after the TYP name) and then, if there is a
// selectable Subtyp, the Subtyp-Picker pre-sorted by the query (ESC goes back
// to the TYP choice). includeManualOff also applies to the Subtyps.
// Resolves with { typ, subtyp } (subtyp null for "no Subtyp"), or null on
// cancel.
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
    subtyps: plugin.getSubtyps(item.typ, options).map(({ subtyp, count }) => ({ typ: item.typ, subtyp, count })),
  }));
  return new Promise((resolve) => new TypSubtypPickerModal(app, plugin, groups, resolve).open());
}

module.exports = { pickTyp, pickSubtyp, pickTypAndSubtyp };
