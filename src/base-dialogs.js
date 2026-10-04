const { ButtonComponent, Modal, Setting } = require("obsidian");
const { plural } = require("./typ-utils");

/* ============================================================
 * The two dialogs of the Base commands (see bases.js):
 *  - column options before creating/updating
 *  - confirming removals when updating
 * ============================================================ */

const NOTE_PREFIX = "note.";

// Column label: the short form the property has in the .base file
// ("Titel" instead of "note.Titel").
function columnLabel(id) {
  return id.startsWith(NOTE_PREFIX) ? id.slice(NOTE_PREFIX.length) : id;
}

function targetLabel(target) {
  if (!target.typ) return `Subtyp ${target.subtyp}`;
  return target.subtyp ? `${target.typ} / ${target.subtyp}` : `TYP ${target.typ}`;
}

/* --- Column options ------------------------------------------------------ */

// Three toggles with a live preview of the resulting columns so a toggle's
// effect needn't be guessed. "All Subtyp properties" only shows for a TYP
// target: in a Subtyp view the other Subtyp blocks would stay empty.
//
// initial presets the toggles. Creating passes nothing - all off, file.name
// plus TYP-Frontmatter is the normal case. Updating passes what the view's
// current columns suggest (optionsFromColumns in bases.js); otherwise the
// removal dialog would offer exactly the columns chosen when the Base was
// created.
class ColumnOptionsModal extends Modal {
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
      new Setting(contentEl)
        .setName(name)
        .setDesc(description)
        .addToggle((control) =>
          control.setValue(this.options[key]).onChange((value) => {
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
    // ESC or a click outside counts as cancel.
    this.resolve(this.confirmed ? this.options : null);
  }
}

function askColumnOptions(plugin, target, preview, initial = null) {
  return new Promise((resolve) => new ColumnOptionsModal(plugin, target, preview, initial, resolve).open());
}

/* --- Confirm removals ---------------------------------------------------- */

// Adding and reordering columns happen silently; only removing is shown,
// because only that loses something. Every entry starts checked; an unchecked
// column is kept (at the front, see updateActiveView).
//
// The question is the title, as in the plugin's other confirmations
// (confirm-modal.js). Not built on ConfirmModal, though: the action button
// follows the checked columns in label and color. Like every dialog that
// rewrites a file, it can't be switched off.
class RemovalModal extends Modal {
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
      text: "These columns don't belong to the TYP. Unchecked ones are kept.",
    });

    // Checkboxes rather than toggles: a toggle reads as a setting that stays,
    // a checkbox as a choice for this one run.
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

    // Cancel drops the whole run (updateActiveView writes nothing), which
    // the dialog itself wouldn't otherwise tell.
    contentEl.createEl("p", {
      cls: "typ-base-removal-note",
      text: "Cancel discards the whole update, including adding and reordering columns.",
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
}

function askRemovals(plugin, columns, viewName) {
  return new Promise((resolve) => new RemovalModal(plugin, columns, viewName, resolve).open());
}

module.exports = { askColumnOptions, askRemovals };
