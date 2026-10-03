const { ItemView, Menu, Modal, Notice, setIcon, debounce } = require("obsidian");
const { mountFrontmatterBlocks } = require("./frontmatter-blocks");
const {
  normalizeSubtypName,
  getSubtypNames,
  ensureSubtyp,
  moveTypSubtyps,
  deleteTypSubtyps,
  mergeTypSubtyps,
  getSubtyp,
  isSubtypManual,
  setSubtypManual,
  setAllSubtypsManual,
  renameSubtyp,
  reorderSubtyps,
  deleteSubtyp,
  mergeSubtyps,
  renameSubtypInNotes,
} = require("./subtyps");
const { normalizeTypName, compareTyps, sortTypsByMode, plural, joinAnd } = require("./typ-utils");
const { typKeyOf, propertyValue, setCanonicalProperty, TYP_PROPERTY, SUBTYP_PROPERTY } = require("./typ-index");
const {
  subtypColor,
  applyColorOffset,
  hasColorOffset,
  subtypHasOwnColor,
  paintColorDot,
  nameColor,
  channelBounds,
  clampedOffset,
  SUBTYP_COLOR_CHANNELS,
  DEFAULT_TYP_COLOR,
} = require("./typ-colors");

const VIEW_TYPE_TYP_PANE = "typ-system-pane";
const DEFAULT_SORT_ORDER = "count-desc";
const DEFAULT_SECONDARY = "subtyps";

// What the TYP-List shows next to the name (settings.typListSecondary),
// cycled by a header button next to sorting (see cycleSecondary) - too few,
// too immediately visible states for a menu.
//   subtyps     - the TYP's Subtyps in brackets, each in its color (like the
//                 preview in the separate TYP-Picker)
//   description - text field to edit the TYP description
//   none        - nothing, the name gets the whole row
// The order is also the cycle order; the first is the default: the Subtyps
// appear nowhere else in the list, the description also in the detail view.
const SECONDARY_MODES = [
  { mode: "subtyps", title: "Subtyp list", icon: "list-tree" },
  { mode: "description", title: "Description", icon: "text-cursor-input" },
  { mode: "none", title: "Nothing", icon: "minus" },
];

const SORT_OPTIONS = [
  // Unlike the others, "manual" has no comparison: the order of settings.typs
  // itself is the storage (see render() and renderRegisteredItem() for the
  // drag & drop rendering built on it). First on purpose - its own group at
  // the top of the menu (see showSortMenu).
  { mode: "manual", title: "Manual (drag & drop)" },
  { mode: "count-desc", title: "Most notes first" },
  { mode: "count-asc", title: "Fewest notes first" },
  { mode: "name-asc", title: "Name (A to Z)" },
  { mode: "name-desc", title: "Name (Z to A)" },
  { mode: "color-asc", title: "Color (red → violet)" },
  { mode: "color-desc", title: "Color (violet → red)" },
];

// Rewrites the TYP of every note with key oldKey (see typKeyOf in
// typ-index.js - the TYP name for a clean value, otherwise the raw form like
// " buch" or "[PERSON, BUCH]") to the single value newValue. Used for
// registerTyp() (cleanup), renaming and merging. Matching is exact on the key,
// so a list is replaced as a whole. A differently spelled property ("typ")
// becomes "TYP".
async function renameTypInNotes(plugin, oldKey, newValue) {
  let changed = 0;
  for (const file of plugin.typIndex.filesWithTyp(oldKey)) {
    let matched = false;
    await plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
      if (typKeyOf(propertyValue(frontmatter, TYP_PROPERTY)) !== oldKey) return;
      setCanonicalProperty(frontmatter, TYP_PROPERTY, newValue);
      matched = true;
    });
    if (matched) changed++;
  }
  return changed;
}

// Cleaned form of a raw value for registerTyp(): a single value trimmed and
// uppercased; a list is deliberately NOT reduced to one item but joined into
// one value "A, B" - which a rename can then turn into another TYP (see
// startDetailRename/showMergeConfirm). normalize spells the single names -
// normalizeSubtypName for Subtyps.
function normalizeRawTyp(raw, normalize = normalizeTypName) {
  if (Array.isArray(raw)) {
    return raw
      .map((v) => normalize(String(v ?? "")))
      .filter(Boolean)
      .join(", ");
  }
  return normalize(String(raw));
}

// Shows an unregistered key: padding would be invisible as plain text, so it
// gets quotes. Lists already carry their brackets in the key.
function displayTypKey(typKey) {
  return typKey !== typKey.trim() ? `"${typKey}"` : typKey;
}

// A TYP name in running text (dialogs): colored when "TYP-Pane" coloring is on
// (colorViews.typList), otherwise a dot before plain text - the same switch as
// in the picker and the list. The caller passes color so a rename can use the
// same (old) color for old and new name. color null = TYP without a color.
function appendTypName(parentEl, plugin, typ, color) {
  if (plugin.settings.colorViews.typList) {
    const nameEl = parentEl.createSpan({ cls: "typ-inline-name", text: typ });
    if (color) nameEl.style.color = color;
  } else {
    paintColorDot(parentEl.createSpan({ cls: "typ-inline-dot" }), color ?? DEFAULT_TYP_COLOR, !color);
    parentEl.createSpan({ cls: "typ-inline-name", text: typ });
  }
}

class ConfirmDeleteTypModal extends Modal {
  constructor(plugin, typ, onConfirm) {
    super(plugin.app);
    this.plugin = plugin;
    this.typ = typ;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    this.modalEl.addClass("typ-confirm-modal");
    const p = contentEl.createEl("p");
    p.appendText("Delete TYP ");
    appendTypName(p, this.plugin, this.typ, this.plugin.settings.typColors[this.typ] ?? null);
    p.appendText("?");

    const buttonRow = contentEl.createDiv({ cls: "modal-button-container" });
    buttonRow.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());

    const confirmBtn = buttonRow.createEl("button", { cls: "mod-warning", text: "Delete" });
    confirmBtn.addEventListener("click", () => {
      this.close();
      this.onConfirm();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

// Shown before "Rename and update notes" (see renderTypSettings and
// startDetailRename). Unlike a plain rename, which only touches the settings,
// this also rewrites the TYP of every affected note - a bulk write across
// possibly many files, hence the explicit confirmation.
class ConfirmRenameTypModal extends Modal {
  constructor(plugin, oldTyp, newTyp, affectedCount, onConfirm, onCancel) {
    super(plugin.app);
    this.plugin = plugin;
    this.oldTyp = oldTyp;
    this.newTyp = newTyp;
    this.affectedCount = affectedCount;
    this.onConfirm = onConfirm;
    this.onCancel = onCancel;
    this.confirmed = false;
  }

  onOpen() {
    const { contentEl } = this;
    this.modalEl.addClass("typ-confirm-modal");
    // Same color for old and new: the new name has no typColors entry yet but
    // takes over the old one's (see applyRename).
    const color = this.plugin.settings.typColors[this.oldTyp] ?? null;
    const p = contentEl.createEl("p");
    p.appendText("Rename TYP ");
    appendTypName(p, this.plugin, this.oldTyp, color);
    p.appendText(" to ");
    appendTypName(p, this.plugin, this.newTyp, color);
    p.appendText(` and update ${plural(this.affectedCount, "note")}?`);

    const buttonRow = contentEl.createDiv({ cls: "modal-button-container" });
    buttonRow.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());

    const confirmBtn = buttonRow.createEl("button", { cls: "mod-cta", text: "Rename" });
    confirmBtn.addEventListener("click", () => {
      this.confirmed = true;
      this.close();
      this.onConfirm();
    });
  }

  // Covers "Cancel" as well as Escape or a click outside.
  onClose() {
    this.contentEl.empty();
    if (!this.confirmed) this.onCancel?.();
  }
}

// Renaming to the name of an already registered TYP (see startDetailRename)
// offers to merge both (see mergeTyp) instead of silently dropping the rename.
// It always rewrites the notes, whichever rename button started it: a merge in
// the settings only would leave the source TYP's notes as an unregistered
// entry.
class ConfirmMergeTypModal extends ConfirmRenameTypModal {
  onOpen() {
    const { contentEl } = this;
    this.modalEl.addClass("typ-confirm-modal");
    const settings = this.plugin.settings;
    const p = contentEl.createEl("p");
    p.appendText("TYP ");
    appendTypName(p, this.plugin, this.newTyp, settings.typColors[this.newTyp] ?? null);
    p.appendText(" already exists. Merge ");
    appendTypName(p, this.plugin, this.oldTyp, settings.typColors[this.oldTyp] ?? null);
    p.appendText(" into it?");

    contentEl.createEl("p", {
      text:
        `${plural(this.affectedCount, "note")} ${this.affectedCount === 1 ? "moves" : "move"} to ${this.newTyp}. ` +
        `The color, description and TYP-Frontmatter of ${this.oldTyp} are dropped. ` +
        `Every Subtyp moves along; blocks with the same name are merged.`,
    });

    const buttonRow = contentEl.createDiv({ cls: "modal-button-container" });
    buttonRow.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());

    const confirmBtn = buttonRow.createEl("button", { cls: "mod-warning", text: "Merge" });
    confirmBtn.addEventListener("click", () => {
      this.confirmed = true;
      this.close();
      this.onConfirm();
    });
  }
}

// Confirmations around Subtyps (see renderSectionFooter): plain text instead
// of colored TYP names, otherwise like the TYP dialogs above.
class ConfirmSubtypModal extends Modal {
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
    this.modalEl.addClass("typ-confirm-modal");
    for (const text of this.paragraphs) contentEl.createEl("p", { text });

    const buttonRow = contentEl.createDiv({ cls: "modal-button-container" });
    buttonRow.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());

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
}

class TypPane extends ItemView {
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
    // "No TYP" without a filter would also match every non-markdown file,
    // which can't have frontmatter - hence file:.md.
    const query = typ === null ? `-["${TYP_PROPERTY}"] file:.md` : this.typClause(typ);
    globalSearch.instance.openGlobalSearch(query);
  }

  // Search clause for a TYP key. A list (unregistered key "[A, B]") has no
  // exact syntax, so it searches notes carrying all its items. Also used by
  // openSubtypSearch(), which can receive an unregistered (unclean) TYP key.
  typClause(typ) {
    const raw = this.plugin.typIndex.rawValueOf(typ);
    return Array.isArray(raw)
      ? raw.map((v) => `["${TYP_PROPERTY}":"${String(v ?? "").trim()}"]`).join(" ")
      : `["${TYP_PROPERTY}":"${typ}"]`;
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
    this.plugin.refreshTypColors?.();

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
    const normalized = normalizeRawTyp(raw === undefined ? typKey : raw);
    if (!normalized) return null;
    if (!this.plugin.settings.typs.includes(normalized)) {
      this.plugin.settings.typs.push(normalized);
    }
    const renamed = normalized !== typKey ? await renameTypInNotes(this.plugin, typKey, normalized) : 0;
    return { typ: normalized, renamed };
  }

  // A new, empty tree item straight in edit mode - like Obsidian's own views
  // (a new bookmark group, say).
  startAdd() {
    if (this.isEditing) return;

    const treeItem = this.listEl.createDiv({ cls: "tree-item" });
    if (this.separatorEl) this.listEl.insertBefore(treeItem, this.separatorEl);
    const self = treeItem.createDiv({ cls: "tree-item-self is-clickable" });
    const inner = self.createDiv({ cls: "tree-item-inner" });

    this.startEditing(null, self, inner);
  }

  // Like Obsidian's tree items: no extra input, the text element itself
  // becomes contenteditable. typ === null means a new entry, otherwise a
  // rename of that TYP.
  startEditing(typ, self, inner) {
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

      const value = normalizeTypName(inner.textContent);
      if (commit && value && value !== typ) {
        const exists = this.plugin.settings.typs.some(
          (t) => t.toLowerCase() === value.toLowerCase() && t !== typ
        );
        if (!exists) {
          if (typ === null) {
            this.plugin.settings.typs.push(value);
          } else {
            const idx = this.plugin.settings.typs.indexOf(typ);
            if (idx !== -1) this.plugin.settings.typs[idx] = value;
            if (this.plugin.settings.typColors[typ] !== undefined) {
              this.plugin.settings.typColors[value] = this.plugin.settings.typColors[typ];
              delete this.plugin.settings.typColors[typ];
            }
            if (this.plugin.settings.typDescriptions[typ] !== undefined) {
              this.plugin.settings.typDescriptions[value] = this.plugin.settings.typDescriptions[typ];
              delete this.plugin.settings.typDescriptions[typ];
            }
            if (this.plugin.settings.typDefaultFrontmatter[typ] !== undefined) {
              this.plugin.settings.typDefaultFrontmatter[value] = this.plugin.settings.typDefaultFrontmatter[typ];
              delete this.plugin.settings.typDefaultFrontmatter[typ];
            }
            if (this.plugin.settings.typFloatingKeys[typ] !== undefined) {
              this.plugin.settings.typFloatingKeys[value] = this.plugin.settings.typFloatingKeys[typ];
              delete this.plugin.settings.typFloatingKeys[typ];
            }
            if (this.plugin.settings.typShortcuts[typ] !== undefined) {
              this.plugin.settings.typShortcuts[value] = this.plugin.settings.typShortcuts[typ];
              delete this.plugin.settings.typShortcuts[typ];
            }
            if (this.ensureTypManual()[typ] !== undefined) {
              this.plugin.settings.typManual[value] = this.plugin.settings.typManual[typ];
              delete this.plugin.settings.typManual[typ];
            }
            moveTypSubtyps(this.plugin.settings, typ, value);
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

  openTypSettings(typ) {
    this.selectedTyp = typ;
    this.render();
  }

  closeTypSettings() {
    this.selectedTyp = null;
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

  render() {
    // Reentrancy guard: renderTypSettings() ends with refreshTypColors(),
    // which via registerTypPane calls render() on every TYP-Pane leaf -
    // including this one, still inside this call. Without the guard that
    // recurses into a stack overflow on every TYP opened or renamed.
    if (this._rendering) return;
    this._rendering = true;
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
      const sortOrder = this.plugin.settings.typSortOrder ?? DEFAULT_SORT_ORDER;
      const isManualSort = sortOrder === "manual";
      const byCurrentOrder = (a, b) => compareTyps(sortOrder, a, b, counts, typColors);

      this.renderListHeader(contentEl);

      const unregisteredRows = [...counts.keys()]
        .filter((typ) => !registered.includes(typ))
        .sort(byCurrentOrder)
        .map((typ) => ({ typ, count: counts.get(typ) ?? 0 }));
      const unregisteredSubtypRows = this.unregisteredSubtypRows();

      // Without a second column the name may take the whole row (see
      // .typ-list-no-secondary in styles.css).
      const listCls = "typ-list nav-files-container" + (this.secondaryMode() === "none" ? " typ-list-no-secondary" : "");
      this.listEl = contentEl.createDiv({ cls: listCls });
      this.separatorEl = null;

      // In manual mode sortTypsByMode() keeps the order of settings.typs,
      // which drag & drop in renderRegisteredItem() rearranges; index is the
      // position in that order.
      const registeredOrder = sortTypsByMode(registered, sortOrder, counts, typColors);
      registeredOrder.forEach((typ, index) => {
        this.renderRegisteredItem(typ, counts.get(typ) ?? 0, { draggable: isManualSort, index });
      });

      // Below the separator three optional sections: unregistered TYP values,
      // unregistered Subtyps, "[NO TYP]". The Subtyps get their own separator
      // because they sort by a different rule (count, not the sort button) -
      // without a visible cut it would look like broken sorting. "[NO TYP]" is
      // no real TYP, takes no part in sorting and always comes last, without a
      // third line.
      //
      // this.separatorEl stays the FIRST line: startAdd() inserts the new item
      // before it, and a new TYP belongs after the registered ones.
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
      attr: { "aria-label": "Add TYP" },
    });
    setIcon(addBtn, "plus");
    addBtn.addEventListener("click", () => this.startAdd());

    const sortBtn = buttonsContainer.createDiv({
      cls: "clickable-icon nav-action-button",
      attr: { "aria-label": "Change sort order" },
    });
    setIcon(sortBtn, "lucide-sort-asc");
    sortBtn.addEventListener("click", (event) => this.showSortMenu(event));

    // Second column: a button cycling the three modes rather than a menu -
    // with so few states whose effect shows right below, clicking through is
    // faster. Icon and tooltip show the current mode.
    const current = SECONDARY_MODES[this.secondaryIndex()];
    const secondaryBtn = buttonsContainer.createDiv({
      cls: "clickable-icon nav-action-button",
      attr: { "aria-label": `Next to name: ${current.title}` },
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
    // Only this list changes, so no refreshTypColors() across all views.
    this.render();
  }

  showSortMenu(event) {
    const current = this.plugin.settings.typSortOrder ?? DEFAULT_SORT_ORDER;
    const menu = new Menu();

    const addGroup = (start, end) => {
      for (let i = start; i < end; i++) {
        const { mode, title } = SORT_OPTIONS[i];
        menu.addItem((item) =>
          item
            .setTitle(title)
            .setChecked(current === mode)
            .onClick(async () => {
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
    colorInput.addEventListener("click", (event) => event.stopPropagation());

    // "input" fires for every intermediate color while the native picker is
    // open - only a local preview here. refreshTypColors() would re-render
    // this view, remove this <input type=color> and close the native picker
    // before a color could even be chosen.
    colorInput.addEventListener("input", async () => {
      showState(colorInput.value, false);
      this.plugin.settings.typColors[typ] = colorInput.value;
      await this.plugin.saveSettings();
      onChange?.(colorInput.value);
    });

    // Once the choice is confirmed and the picker closed, a re-render can't
    // break anything any more.
    colorInput.addEventListener("change", () => this.plugin.refreshTypColors?.());

    if (showReset) {
      resetBtn = parent.createDiv({
        cls: "clickable-icon typ-color-reset",
        attr: { "aria-label": "Reset color" },
      });
      setIcon(resetBtn, "rotate-ccw");
      resetBtn.addEventListener("click", async () => {
        delete this.plugin.settings.typColors[typ];
        colorInput.value = DEFAULT_TYP_COLOR;
        showState(DEFAULT_TYP_COLOR, true);
        await this.plugin.saveSettings();
        this.plugin.refreshTypColors?.();
        onChange?.(DEFAULT_TYP_COLOR);
      });
    }
    showState(currentColor, this.plugin.settings.typColors[typ] === undefined);

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
      attr: { tabindex: "0", role: "checkbox" },
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
      isSubtypManual(this.plugin.settings, typ, subtyp),
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
      el.typShowManualState(isSubtypManual(this.plugin.settings, typ, el.typSubtyp));
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

    // Second column, cycled by the header button (see SECONDARY_MODES).
    const secondary = this.secondaryMode();
    if (secondary === "description") this.renderDescriptionInput(self, typ);
    else if (secondary === "subtyps") this.renderSubtypPreview(self, typ);

    this.renderCountFlair(self, count);

    self.addEventListener("click", () => {
      if (this.isEditing) return;
      this.openTypSettings(typ);
    });
    self.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.openSearch(typ);
    });

    // Only in manual sort mode (see render()): the whole row can be dragged
    // (a drag starting on the dot or in the description field doesn't count -
    // those take the mousedown themselves). Moves entries in settings.typs,
    // the list that is the display order in manual mode.
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

  // A real input, so the description can be edited right in the list. Its
  // click must NOT trigger the row (which would open the detail view).
  renderDescriptionInput(self, typ) {
    const descInput = self.createEl("input", {
      type: "text",
      cls: "typ-list-description-input",
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
    const subtyps = getSubtypNames(this.plugin.settings, typ);
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
      const known = getSubtypNames(this.plugin.settings, typ);
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
    const typResult = this.plugin.settings.typs.includes(typKey)
      ? { typ: typKey, renamed: 0 }
      : await this.applyTypRegistration(typKey);
    if (!typResult) return;

    const subtypResult = await this.applySubtypRegistration(typResult.typ, subtypKey, bucket);
    await this.plugin.saveSettings();
    this.render();
    this.plugin.refreshTypColors?.();

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
    // A custom property instead of color: an inline color beats every
    // stylesheet rule, and the accent color on hover (.typ-searchable) would
    // need !important.
    if (titleColor) titleEl.style.setProperty("--typ-name-color", titleColor);
    this.makeSearchable(titleEl, () => this.openSearch(typ));

    const { counts } = this.plugin.typIndex.typCounts();
    header.createSpan({ cls: "typ-detail-count", text: String(counts.get(typ) ?? 0) });

    // Left of the plain rename button, highlighted in accent color: this one
    // also rewrites the TYP of every affected note (after confirmation, see
    // startDetailRename/ConfirmRenameTypModal).
    const renameWithNotesBtn = header.createDiv({
      cls: "clickable-icon typ-detail-rename-notes",
      attr: { "aria-label": "Rename and update notes" },
    });
    setIcon(renameWithNotesBtn, "pencil");
    renameWithNotesBtn.addEventListener("click", () => this.startDetailRename(typ, titleEl, { updateNotes: true }));

    const renameBtn = header.createDiv({ cls: "clickable-icon typ-detail-rename", attr: { "aria-label": "Rename" } });
    setIcon(renameBtn, "pencil");
    renameBtn.addEventListener("click", () => this.startDetailRename(typ, titleEl));

    // Between rename and delete, in the same spot as for a Subtyp (see
    // renderSectionFooter).
    this.renderManualToggle(header, typ);

    const deleteBtn = header.createDiv({ cls: "clickable-icon typ-detail-delete", attr: { "aria-label": "Delete" } });
    setIcon(deleteBtn, "trash");
    deleteBtn.addEventListener("click", () => this.showDeleteConfirm(typ));

    const body = contentEl.createDiv({ cls: "typ-detail-body" });

    // One row below the header: the TYP color on the left, the description
    // filling the rest.
    const optionsHeader = body.createDiv({ cls: "typ-frontmatter-header typ-options-header" });

    const colorRow = optionsHeader.createDiv({ cls: "typ-detail-color-row" });
    this.renderColorPicker(
      colorRow,
      typ,
      (newColor) => {
        if (!this.plugin.settings.colorViews.typList) return;
        // Same custom property as above, not style.color (see there).
        titleEl.style.setProperty("--typ-name-color", newColor);
      },
      { showReset: true }
    );

    // Single-line input next to the color, like the one in the TYP-List. No
    // heading: while empty, its faded placeholder says what it is.
    const descInput = optionsHeader.createEl("input", {
      type: "text",
      cls: "typ-description-input",
      attr: { placeholder: "Description" },
    });
    descInput.value = this.plugin.settings.typDescriptions[typ] ?? "";
    descInput.addEventListener("change", async () => {
      const value = descInput.value.trim();
      if (value) this.plugin.settings.typDescriptions[typ] = value;
      else delete this.plugin.settings.typDescriptions[typ];
      await this.plugin.saveSettings();
    });

    // Separates the frontmatter blocks from the TYP's other settings.
    body.createDiv({ cls: "typ-detail-separator" });

    // TYP-Frontmatter and one block per registered Subtyp below, each with its
    // own editor (see frontmatter-blocks.js), so the same key may appear in
    // several blocks. A Subtyp block adds to the TYP-Frontmatter for notes with
    // that SUBTYP and overrides same-named properties (see subtyps.js).
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
      },
    });
    this.frontmatterEditors.push(...this.frontmatterBlocks.editors);

    // Full width and accent color, to stand apart from the blocks' small icon
    // buttons.
    this.subtypAddBtnEl = body.createEl("button", { cls: "mod-cta typ-subtyp-add" });
    setIcon(this.subtypAddBtnEl.createSpan({ cls: "typ-subtyp-add-icon" }), "plus");
    this.subtypAddBtnEl.createSpan({ text: "Add Subtyp" });
    this.subtypAddBtnEl.addEventListener("click", () => this.startAddSubtyp(typ));

    this.renderUnregisteredSubtyps(body, typ, bucket);

    body.createDiv({ cls: "typ-detail-separator" });
    this.renderFloatingHint(body);
    // The bold marks (frontmatter-default-highlight.js) only react to metadata
    // and layout events; opening this view fires none, so refresh here. Only
    // this one refresh, not the full refreshTypColors(), which would call
    // render() on this view while it is still rendering.
    this.plugin.refreshFrontmatterHighlight?.();
  }

  // A block's heading (see frontmatter-blocks.js): title with note count (for
  // the TYP-Frontmatter the notes without SUBTYP, the only ones it applies to
  // alone), search on click, and the two add buttons for a blank row in this
  // block.
  renderSectionHeader(el, typ, section, bucket, blocks) {
    const titleGroup = el.createDiv({ cls: "typ-frontmatter-title-group" });
    // Never colored, unlike the detail title above: a block's color sits in
    // its footer dot (see renderSectionFooter).
    const titleEl = titleGroup.createDiv({ cls: "typ-detail-section-title", text: section ?? `${typ}-Frontmatter` });
    const count = section === null ? bucket.noSubtyp : bucket.counts.get(section) ?? 0;
    titleGroup.createSpan({ cls: "typ-subtyp-count", text: String(count) });
    this.makeSearchable(titleEl, () => this.openSubtypSearch(typ, section));

    // Floating properties share the list and order of the others (which
    // frontmatter sorting relies on), so they land wherever drag & drop puts
    // them instead of at the end of a second list.
    const addButtons = el.createDiv({ cls: "typ-frontmatter-add-group" });

    // Left of the plain button, in accent color: marks the next added (or,
    // until saved, renamed) property as floating (see
    // editor.typPendingFloatingAdd). Floating properties aren't created for new
    // notes (see getTypDefaults()) and show in italics where present.
    const addFloatingPropertyBtn = addButtons.createDiv({
      cls: "clickable-icon typ-frontmatter-add-floating",
      attr: { "aria-label": "Add floating property" },
    });
    setIcon(addFloatingPropertyBtn, "plus");
    addFloatingPropertyBtn.addEventListener("click", () => blocks.addBlank(section, true));

    const addPropertyBtn = addButtons.createDiv({
      cls: "clickable-icon typ-frontmatter-add",
      attr: { "aria-label": "Add property" },
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
    // A ring also while the TYP itself has no color - then an offset colors
    // nothing anywhere.
    const ownColor = subtypHasOwnColor(this.plugin.settings, typ, subtyp);
    const typHasColor = !!this.plugin.settings.typColors[typ];
    const colorDot = colorGroup.createDiv({
      cls: "typ-subtyp-color-dot",
      attr: { "aria-label": !typHasColor ? "TYP has no color" : ownColor ? "Adjust color" : "Uses TYP color" },
    });
    colorDot.typSubtyp = subtyp;
    paintColorDot(colorDot, subtypColor(this.plugin.settings, typ, subtyp) ?? DEFAULT_TYP_COLOR, !ownColor || !typHasColor);
    colorDot.addEventListener("click", () => this.openSubtypColorPopover(colorDot, typ, subtyp));
    const resetBtn = colorGroup.createDiv({ cls: "clickable-icon typ-color-reset", attr: { "aria-label": "Reset color" } });
    resetBtn.toggleClass("is-disabled", !ownColor);
    setIcon(resetBtn, "rotate-ccw");
    resetBtn.addEventListener("click", async () => {
      const data = getSubtyp(this.plugin.settings, typ, subtyp);
      if (!data?.color) return;
      delete data.color;
      await this.plugin.saveSettings();
      this.plugin.refreshTypColors?.();
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
      attr: { "aria-label": "Rename and update notes" },
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
  // it can reach. Dragging only updates the dot here; saving and updating the
  // other views happens on close (click outside or Escape), since
  // refreshTypColors() re-renders this view among others.
  openSubtypColorPopover(anchorEl, typ, subtyp) {
    this.closeSubtypColorPopover?.();
    const { settings } = this.plugin;
    const data = getSubtyp(settings, typ, subtyp);
    if (!data) return;
    const typColor = settings.typColors[typ] ?? DEFAULT_TYP_COLOR;
    // Without an offset every slider starts at 0; SUBTYP_COLOR_CHANNELS alone
    // says which exist.
    const offset = clampedOffset(settings, data.color) ?? Object.fromEntries(SUBTYP_COLOR_CHANNELS.map(({ key }) => [key, 0]));
    const doc = anchorEl.doc;
    const popover = doc.body.createDiv({ cls: "menu typ-subtyp-color-popover" });

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
      input.disabled = min === max;
      const valueEl = row.createSpan({ cls: "typ-subtyp-color-value" });
      input.addEventListener("input", () => {
        offset[key] = Number(input.value);
        update();
      });
      rows.push(() => {
        const steps = 8;
        const stops = [];
        for (let i = 0; i <= steps; i++) {
          stops.push(applyColorOffset(typColor, { ...offset, [key]: min + ((max - min) * i) / steps }));
        }
        input.style.setProperty("--typ-track", `linear-gradient(to right, ${stops.join(", ")})`);
        valueEl.setText(`${offset[key] > 0 ? "+" : ""}${offset[key]}${unit}`);
      });
    }
    update();

    // Below the dot, but inside the window.
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
      const current = getSubtyp(settings, typ, subtyp);
      if (!current) return;
      if (hasColorOffset(offset)) current.color = { ...offset };
      else delete current.color;
      await this.plugin.saveSettings();
      this.plugin.refreshTypColors?.();
      this.render();
    };
    this.closeSubtypColorPopover = close;
    doc.addEventListener("mousedown", onPointerDown, true);
    doc.addEventListener("keydown", onKeyDown, true);
  }

  // Deletes the Subtyp block with its properties. Notes keep their SUBTYP
  // value (it then shows as unregistered below), so confirmation is only
  // needed when properties would be lost.
  deleteSubtypWithConfirm(typ, subtyp) {
    const apply = async () => {
      deleteSubtyp(this.plugin.settings, typ, subtyp);
      await this.plugin.saveSettings();
      this.plugin.refreshTypColors?.();
      this.render();
    };
    const keys = Object.keys(getSubtyp(this.plugin.settings, typ, subtyp)?.frontmatter ?? {}).filter((key) => key !== "");
    if (keys.length === 0) {
      apply();
      return;
    }
    new ConfirmSubtypModal(this.app, {
      paragraphs: [
        `Delete Subtyp ${subtyp} of ${typ}?`,
        keys.length === 1
          ? `Its property ${keys[0]} will be lost.`
          : `Its ${keys.length} properties ${keys.join(", ")} will be lost.`,
      ],
      confirmText: "Delete",
      confirmCls: "mod-warning",
      onConfirm: apply,
    }).open();
  }

  // Like startDetailRename(), on a Subtyp block's title. The block keeps its
  // position; updateNotes: true also rewrites the SUBTYP of the affected notes
  // after confirmation. An existing name offers a merge instead (which always
  // rewrites the notes).
  startSubtypRename(typ, subtyp, titleEl, { updateNotes = false } = {}) {
    if (this.isEditing) return;
    this.isEditing = true;

    titleEl.addClass("typ-subtyp-name-input", "is-being-renamed");
    titleEl.setAttribute("contenteditable", "true");
    titleEl.setAttribute("spellcheck", "false");
    titleEl.focus();

    const range = titleEl.doc.createRange();
    range.selectNodeContents(titleEl);
    const selection = titleEl.win.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    const countOf = (name) => this.plugin.typIndex.subtypBucket(typ).counts.get(name) ?? 0;
    const applyRename = async (value, { withNotes }) => {
      renameSubtyp(this.plugin.settings, typ, subtyp, value);
      await this.plugin.saveSettings();
      const renamed = withNotes ? await renameSubtypInNotes(this.plugin, typ, subtyp, value) : 0;
      this.plugin.refreshTypColors?.();
      if (withNotes) new Notice(`Subtyp ${value}: ${plural(renamed, "note")} updated.`);
      this.render();
    };

    let done = false;
    const finish = async (commit) => {
      if (done) return;
      done = true;
      this.isEditing = false;

      const value = normalizeSubtypName(titleEl.textContent);
      if (!commit || !value || value === subtyp) {
        this.render();
        return;
      }

      const existing = getSubtypNames(this.plugin.settings, typ).find(
        (name) => name.toLowerCase() === value.toLowerCase() && name !== subtyp
      );
      if (existing) {
        new ConfirmSubtypModal(this.app, {
          paragraphs: [
            `Subtyp ${existing} already exists in ${typ}. Merge ${subtyp} into it?`,
            `${plural(countOf(subtyp), "note")} ${countOf(subtyp) === 1 ? "moves" : "move"} to ${existing}, and the properties of ${subtyp} move into the ${existing} block.`,
          ],
          confirmText: "Merge",
          confirmCls: "mod-warning",
          onConfirm: async () => {
            mergeSubtyps(this.plugin.settings, typ, subtyp, existing);
            await this.plugin.saveSettings();
            const renamed = await renameSubtypInNotes(this.plugin, typ, subtyp, existing);
            this.plugin.refreshTypColors?.();
            new Notice(`Subtyp ${subtyp} merged into ${existing}, ${plural(renamed, "note")} updated.`);
            this.render();
          },
          onCancel: () => this.render(),
        }).open();
        return;
      }

      if (!updateNotes) {
        await applyRename(value, { withNotes: false });
        return;
      }
      new ConfirmSubtypModal(this.app, {
        paragraphs: [`Rename Subtyp ${subtyp} to ${value} and update ${plural(countOf(subtyp), "note")}?`],
        confirmText: "Rename",
        confirmCls: "mod-cta",
        onConfirm: () => applyRename(value, { withNotes: true }),
        onCancel: () => this.render(),
      }).open();
    };

    // Keep every key here: the title sits inside Obsidian's property editor,
    // whose keyboard navigation would react too (Escape also because of the
    // detail view, see onOpen).
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

  // Like the unregistered entries of the TYP-List: SUBTYP values of this TYP's
  // notes that have no block yet (notes without any SUBTYP count for the
  // TYP-Frontmatter instead). Shown like Subtyp blocks, but only heading and
  // count. A click on the block registers the value; a click on the name opens
  // the search instead - checking what a value holds before registering it is
  // the common case. The name lights up in accent color on hover to show it
  // does something different from the area around it.
  renderUnregisteredSubtyps(parent, typ, bucket) {
    const registered = getSubtypNames(this.plugin.settings, typ);
    const unregistered = [...bucket.counts.keys()]
      .filter((key) => !registered.includes(key))
      .sort((a, b) => bucket.counts.get(b) - bucket.counts.get(a) || a.localeCompare(b));
    if (unregistered.length === 0) return;

    const listEl = parent.createDiv({ cls: "typ-subtyp-unregistered-list" });
    for (const key of unregistered) {
      const block = listEl.createDiv({ cls: "typ-frontmatter-block typ-subtyp-block typ-subtyp-unregistered" });
      const header = block.createDiv({ cls: "typ-frontmatter-header" });
      const titleGroup = header.createDiv({ cls: "typ-frontmatter-title-group" });
      const titleEl = titleGroup.createDiv({ cls: "typ-detail-section-title", text: displayTypKey(key) });
      titleGroup.createSpan({ cls: "typ-subtyp-count", text: String(bucket.counts.get(key)) });
      block.addEventListener("click", () => this.registerSubtyp(typ, key, bucket));
      // stopPropagation, or the same click would also register the value one
      // only wanted to look up.
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
      subtypClause = `-["${SUBTYP_PROPERTY}"]`;
    } else {
      const raw = this.plugin.typIndex.subtypBucket(typ).rawByKey.get(subtypKey);
      subtypClause = Array.isArray(raw)
        ? raw.map((v) => `["${SUBTYP_PROPERTY}":"${String(v ?? "").trim()}"]`).join(" ")
        : `["${SUBTYP_PROPERTY}":"${subtypKey}"]`;
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
    this.plugin.refreshTypColors?.();
    if (result.renamed > 0) new Notice(`Subtyp ${result.subtyp} registered, ${plural(result.renamed, "note")} updated.`);
  }

  // Like applyTypRegistration: the core without saving and notice, so
  // registerTypWithSubtyp() can bundle it. Returns { subtyp, renamed } or null.
  async applySubtypRegistration(typ, subtypKey, bucket) {
    const raw = bucket.rawByKey.get(subtypKey);
    const normalized = normalizeRawTyp(raw === undefined ? subtypKey : raw, normalizeSubtypName);
    if (!normalized) return null;
    const existing = getSubtypNames(this.plugin.settings, typ).find((name) => name.toLowerCase() === normalized.toLowerCase());
    const subtyp = existing ?? normalized;
    ensureSubtyp(this.plugin.settings, typ, subtyp);

    const renamed = subtyp !== subtypKey ? await renameSubtypInNotes(this.plugin, typ, subtypKey, subtyp) : 0;
    return { subtyp, renamed };
  }

  // A new, empty Subtyp block right above the "Add Subtyp" button, its name
  // typed inline (like startAdd() in the list).
  startAddSubtyp(typ) {
    if (this.isEditing || !this.subtypAddBtnEl) return;
    this.isEditing = true;

    // Built like the finished (empty) block, with the "+" buttons and footer
    // actions that do nothing yet, just without a count - so nothing jumps
    // when the input is done (see .typ-subtyp-pending).
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
    // The state ensureSubtyp will give the new Subtyp: that of its TYP.
    const manualCls = "clickable-icon typ-manual-icon" + (this.ensureTypManual()[typ] !== false ? " is-active" : "");
    setIcon(actions.createDiv({ cls: manualCls }), "file-pen-line");
    setIcon(actions.createDiv({ cls: "clickable-icon typ-detail-delete" }), "trash");
    nameEl.setAttribute("contenteditable", "true");
    nameEl.setAttribute("spellcheck", "false");
    nameEl.focus();

    let done = false;
    const finish = async (commit) => {
      if (done) return;
      done = true;
      this.isEditing = false;

      const value = normalizeSubtypName(nameEl.textContent);
      if (commit && value) {
        const existing = getSubtypNames(this.plugin.settings, typ).find((name) => name.toLowerCase() === value.toLowerCase());
        if (existing) {
          new Notice(`${typ} already has Subtyp ${existing}.`);
        } else {
          ensureSubtyp(this.plugin.settings, typ, value);
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
        // stopPropagation, or the detail view's own Escape handler would leave
        // it as well.
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      }
    });
    nameEl.addEventListener("blur", () => finish(true));
  }

  showDeleteConfirm(typ) {
    new ConfirmDeleteTypModal(this.plugin, typ, async () => {
      this.plugin.settings.typs = this.plugin.settings.typs.filter((t) => t !== typ);
      delete this.plugin.settings.typColors[typ];
      delete this.plugin.settings.typDescriptions[typ];
      delete this.plugin.settings.typDefaultFrontmatter[typ];
      delete this.plugin.settings.typFloatingKeys[typ];
      delete this.plugin.settings.typShortcuts[typ];
      delete this.ensureTypManual()[typ];
      deleteTypSubtyps(this.plugin.settings, typ);
      // Back to the list before refreshTypColors(), which re-renders
      // synchronously - otherwise the deleted TYP's now empty detail view
      // would briefly render again.
      this.closeTypSettings();
      await this.plugin.saveSettings();
      this.plugin.refreshTypColors?.();
    }).open();
  }

  // Like startEditing(), but on the detail view's title, switching
  // selectedTyp instead of just re-rendering the list. updateNotes: true (the
  // highlighted button) also rewrites the TYP of every affected note after
  // confirmation (see renameTypInNotes) instead of only the settings.
  startDetailRename(typ, titleEl, { updateNotes = false } = {}) {
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

    // Moves only the settings (list, color, description, TYP-Frontmatter,
    // manual toggle) to the new name - touches no notes. Shared by both rename
    // paths.
    const applyRename = async (value) => {
      const idx = this.plugin.settings.typs.indexOf(typ);
      if (idx !== -1) this.plugin.settings.typs[idx] = value;
      if (this.plugin.settings.typColors[typ] !== undefined) {
        this.plugin.settings.typColors[value] = this.plugin.settings.typColors[typ];
        delete this.plugin.settings.typColors[typ];
      }
      if (this.plugin.settings.typDescriptions[typ] !== undefined) {
        this.plugin.settings.typDescriptions[value] = this.plugin.settings.typDescriptions[typ];
        delete this.plugin.settings.typDescriptions[typ];
      }
      if (this.plugin.settings.typDefaultFrontmatter[typ] !== undefined) {
        this.plugin.settings.typDefaultFrontmatter[value] = this.plugin.settings.typDefaultFrontmatter[typ];
        delete this.plugin.settings.typDefaultFrontmatter[typ];
      }
      if (this.plugin.settings.typFloatingKeys[typ] !== undefined) {
        this.plugin.settings.typFloatingKeys[value] = this.plugin.settings.typFloatingKeys[typ];
        delete this.plugin.settings.typFloatingKeys[typ];
      }
      if (this.plugin.settings.typShortcuts[typ] !== undefined) {
        this.plugin.settings.typShortcuts[value] = this.plugin.settings.typShortcuts[typ];
        delete this.plugin.settings.typShortcuts[typ];
      }
      if (this.ensureTypManual()[typ] !== undefined) {
        this.plugin.settings.typManual[value] = this.plugin.settings.typManual[typ];
        delete this.plugin.settings.typManual[typ];
      }
      moveTypSubtyps(this.plugin.settings, typ, value);
      // Set before refreshTypColors(), which calls render() synchronously -
      // otherwise the old, now empty name would briefly render.
      this.selectedTyp = value;
      await this.plugin.saveSettings();
      this.plugin.refreshTypColors?.();
    };

    let done = false;
    const finish = async (commit) => {
      if (done) return;
      done = true;
      this.isEditing = false;

      const value = normalizeTypName(titleEl.textContent);
      if (!commit || !value || value === typ) {
        this.render();
        return;
      }

      const existing = this.plugin.settings.typs.find(
        (t) => t.toLowerCase() === value.toLowerCase() && t !== typ
      );
      if (existing) {
        this.showMergeConfirm(typ, existing);
        return;
      }

      if (!updateNotes) {
        await applyRename(value);
        this.render();
        return;
      }

      // A bulk write across possibly many files - confirm first.
      const { counts } = this.plugin.typIndex.typCounts();
      new ConfirmRenameTypModal(
        this.plugin,
        typ,
        value,
        counts.get(typ) ?? 0,
        async () => {
          await applyRename(value);
          const renamed = await renameTypInNotes(this.plugin, typ, value);
          new Notice(`TYP ${value}: ${plural(renamed, "note")} updated.`);
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
        // stopPropagation, or the detail view's Escape handler would leave it
        // as well.
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      }
    });

    titleEl.addEventListener("blur", () => finish(true));
  }

  showMergeConfirm(source, target) {
    const { counts } = this.plugin.typIndex.typCounts();
    new ConfirmMergeTypModal(
      this.plugin,
      source,
      target,
      counts.get(source) ?? 0,
      () => this.mergeTyp(source, target),
      () => this.render()
    ).open();
  }

  // Merges source into target: notes are rewritten to target, source leaves
  // the list with its settings (target keeps its own). Source's Subtyps move
  // over, same-named blocks are combined (see mergeTypSubtyps in subtyps.js).
  //
  // "Manually creatable" is where a merge does more than move data: the moved
  // Subtyps bring source's toggles but end up under target's. With source on
  // and target off they would be switched-on Subtyps under a switched-off TYP,
  // unreachable in the picker. So a switched-off target switches them off too,
  // as its own button would (see renderManualToggle). With target on they stay
  // as they were.
  async mergeTyp(source, target) {
    const settings = this.plugin.settings;
    const renamed = await renameTypInNotes(this.plugin, source, target);

    settings.typs = settings.typs.filter((t) => t !== source);
    delete settings.typColors[source];
    delete settings.typDescriptions[source];
    delete settings.typDefaultFrontmatter[source];
    delete settings.typFloatingKeys[source];
    delete settings.typShortcuts[source];
    delete this.ensureTypManual()[source];
    mergeTypSubtyps(settings, source, target);
    if (this.ensureTypManual()[target] === false) setAllSubtypsManual(settings, target, false);

    // Set before refreshTypColors(), as in applyRename.
    this.selectedTyp = target;
    await this.plugin.saveSettings();
    this.plugin.refreshTypColors?.();
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
      text: "Right-click a property to make it floating.",
    });
  }
}

function registerTypPane(plugin) {
  plugin.registerView(VIEW_TYPE_TYP_PANE, (leaf) => new TypPane(leaf, plugin));

  plugin.addCommand({
    id: "open-typ-pane",
    name: "Open TYP-Pane",
    callback: () => activateTypPane(plugin),
  });

  plugin.addCommand({
    id: "add-typ-property",
    name: "Add TYP-Frontmatter property",
    callback: () => addTypPropertyCommand(plugin),
  });

  // On hot reload the old leaf object survives (only our module reloads), but
  // "instanceof TypPane" fails against the reloaded class, and getViewType()
  // comes from leaf.view alone. `app` survives unchanged, so the leaf
  // reference is kept there.
  plugin.app.workspace.onLayoutReady(() => activateTypPane(plugin, false, false));

  const refresh = () => {
    for (const leaf of plugin.app.workspace.getLeavesOfType(VIEW_TYPE_TYP_PANE)) {
      leaf.view?.render?.();
    }
  };

  // Keeps the counts current on every TYP-relevant change elsewhere (new or
  // deleted note, TYP or SUBTYP changed). The index's "change" fires only for
  // those, not on every autosave. Debounced anyway since rendering the list is
  // relatively costly; resetTimer collects a burst (bulk import) into one.
  const debouncedRefresh = debounce(refresh, 500, true);
  plugin.registerEvent(plugin.typIndex.on("change", debouncedRefresh));
  // The "Excluded files" list changed (Hide Folders toggling a folder, say).
  plugin.registerEvent(plugin.app.vault.on("config-changed", debouncedRefresh));

  // For plugin.refreshTypColors: re-renders the list or the detail view.
  return refresh;
}

// createIfMissing: false for the automatic onLayoutReady call (see
// registerTypPane), which should only reconnect an existing leaf orphaned by
// hot reload, not create one on every start. A pane that was closed stays
// closed.
async function activateTypPane(plugin, reveal = true, createIfMissing = true) {
  const app = plugin.app;
  const { workspace } = app;

  const candidates = [];
  workspace.iterateAllLeaves((leaf) => {
    if (
      leaf === app.__typSystemLeaf ||
      (leaf.view && leaf.view.getViewType() === VIEW_TYPE_TYP_PANE)
    ) {
      candidates.push(leaf);
    }
  });

  let leaf = candidates.shift() ?? null;
  for (const extra of candidates) extra.detach();

  if (!leaf) {
    if (!createIfMissing) return;
    leaf = workspace.getLeftLeaf(false);
    await leaf.setViewState({ type: VIEW_TYPE_TYP_PANE, active: true });
  } else if (!(leaf.view instanceof TypPane)) {
    // active: false - just reconnecting. onLayoutReady fires at once once the
    // layout is ready, so active: true would steal focus on every hot reload.
    await leaf.setViewState({ type: VIEW_TYPE_TYP_PANE, active: false });
  }

  app.__typSystemLeaf = leaf;
  if (reveal) workspace.revealLeaf(leaf);
}

// Prefers an open TYP-Pane detail (exactly like its "+" button); otherwise
// opens the detail view for the active note's TYP and adds the property there.
// Without an open note or TYP, a TYP-Pane showing a detail view - even
// unfocused - is the fallback. The bare list doesn't count: it has no editor
// to add to.
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
    const openLeaf = app.workspace
      .getLeavesOfType(VIEW_TYPE_TYP_PANE)
      .find((leaf) => leaf.view instanceof TypPane && leaf.view.selectedTyp !== null);
    if (openLeaf) {
      await app.workspace.revealLeaf(openLeaf);
      openLeaf.view.frontmatterBlocks?.addBlank(null);
      return;
    }
    new Notice(
      file
        ? "The active note has no TYP, and no TYP is open in the TYP-Pane."
        : "No note is open, and no TYP is open in the TYP-Pane."
    );
    return;
  }

  await activateTypPane(plugin);
  const view = app.__typSystemLeaf?.view;
  if (!(view instanceof TypPane)) return;
  view.openTypSettings(typ);
  view.frontmatterBlocks?.addBlank(null);
}

module.exports = { registerTypPane, VIEW_TYPE_TYP_PANE, compareTyps, sortTypsByMode, DEFAULT_SORT_ORDER, DEFAULT_TYP_COLOR };
