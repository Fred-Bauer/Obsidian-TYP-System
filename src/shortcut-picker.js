const { FuzzySuggestModal, Modal, Setting } = require("obsidian");
const { FIXED_SHORTCUTS, SCRIPT_PREFIX, buildArgs, inputParams } = require("./shortcuts");

// List label: the name, plus the declared parameter names for a script, so
// the picker already shows that (and how) it takes arguments.
function itemLabel(item) {
  return item.params ? `${item.name}(${item.params.join(", ")})` : item.name;
}

// Picks a shortcut for a TYP-Frontmatter property (button or chip in the row,
// see typ-frontmatter-editor.js). Searchable, and scripts show the description
// from their @typ-shortcut marker. Never free text: the list is the source of
// truth, so a typo in a script name is impossible.
class ShortcutPickerModal extends FuzzySuggestModal {
  constructor(app, key, items, resolve) {
    super(app);
    this.items = items;
    this.resolve = resolve;
    this.chosen = false;
    this.setPlaceholder(`Shortcut für „${key}“ – ESC für Abbruch`);
  }

  getItems() {
    return this.items;
  }

  // Fuzzy search also covers the description: "Erstellungsdatum" finds "created".
  getItemText(item) {
    const label = itemLabel(item);
    return item.description ? `${label} ${item.description}` : label;
  }

  renderSuggestion(match, el) {
    const item = match.item;
    el.addClass("typ-shortcut-suggestion");
    el.createEl("code", { cls: "typ-shortcut-suggestion-name", text: itemLabel(item) });
    if (item.description) el.createSpan({ cls: "typ-shortcut-suggestion-desc", text: item.description });
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
}

// Asks for the arguments of a script that declares some: one dialog with all
// fields, named after the script's parameters and prefilled with the stored
// values, so picking the same script again is how single values get fixed.
// An empty field means "not set" (see buildArgs); there is no validation,
// since only the script knows what it needs.
class ShortcutArgsModal extends Modal {
  constructor(app, item, existing, resolve) {
    super(app);
    this.item = item;
    this.resolve = resolve;
    this.fields = inputParams(item.params);
    this.inputs = {};
    for (const name of this.fields) {
      const value = existing?.[name];
      this.inputs[name] = value === undefined || value === null ? "" : String(value);
    }
    this.confirmed = false;
  }

  onOpen() {
    this.titleEl.setText(`Argumente für ${this.item.name}`);
    if (this.item.description) {
      this.contentEl.createDiv({ cls: "typ-shortcut-args-desc", text: this.item.description });
    }
    for (const name of this.fields) {
      new Setting(this.contentEl).setName(name).addText((text) =>
        text
          .setValue(this.inputs[name])
          .onChange((value) => {
            this.inputs[name] = value;
          })
          // Enter submits, like Obsidian's own rename dialogs.
          .inputEl.addEventListener("keydown", (event) => {
            if (event.key === "Enter" && !event.isComposing) {
              event.preventDefault();
              this.submit();
            }
          })
      );
    }
    new Setting(this.contentEl).addButton((button) =>
      button
        .setButtonText("Übernehmen")
        .setCta()
        .onClick(() => this.submit())
    );
  }

  submit() {
    this.confirmed = true;
    this.close();
  }

  onClose() {
    this.contentEl.empty();
    // ESC or a click outside keeps the current shortcut - an accidental close
    // must not silently lose data.
    this.resolve(this.confirmed ? buildArgs(this.fields, this.inputs) : null);
  }
}

// Opens the picker for property `key`. getScripts is the accessor from
// registerShortcutScripts(); current is the shortcut set now (to prefill the
// arguments). Resolves with the new record ({ name } or { name, args }), or
// null on cancel - also when a script was picked but its argument dialog was
// cancelled.
async function pickShortcut(app, key, getScripts, current = null) {
  const items = [
    ...FIXED_SHORTCUTS.map(({ name, description }) => ({ name, description, params: null })),
    ...getScripts().map(({ name, params, description }) => ({ name: SCRIPT_PREFIX + name, params, description })),
  ];

  const item = await new Promise((resolve) => new ShortcutPickerModal(app, key, items, resolve).open());
  if (!item) return null;
  // No fields to ask for (fixed tokens, or only reserved names like
  // "(newFile)"): no second step.
  if (inputParams(item.params).length === 0) return { name: item.name };

  // Prefill only for the same script; old values mean nothing to another one.
  const prefill = current?.name === item.name ? current.args : null;
  const args = await new Promise((resolve) => new ShortcutArgsModal(app, item, prefill, resolve).open());
  if (args === null) return null;
  return Object.keys(args).length > 0 ? { name: item.name, args } : { name: item.name };
}

module.exports = { pickShortcut };
