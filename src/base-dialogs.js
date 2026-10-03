const { Modal, Setting } = require("obsidian");
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

// Three toggles, all off by default (file.name plus TYP-Frontmatter is the
// normal case), with a live preview of the resulting columns so a toggle's
// effect needn't be guessed. "All Subtyp properties" only shows for a TYP
// target: in a Subtyp view the other Subtyp blocks would stay empty.
class ColumnOptionsModal extends Modal {
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

function askColumnOptions(plugin, target, preview) {
  return new Promise((resolve) => new ColumnOptionsModal(plugin, target, preview, resolve).open());
}

/* --- Confirm removals ---------------------------------------------------- */

// Adding and reordering columns happen silently; only removing is shown,
// because only that loses something. Every entry starts checked; an unchecked
// column is kept (at the front, see updateActiveView).
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
    this.titleEl.setText(`Remove columns from "${this.viewName}"`);
    contentEl.createEl("p", {
      cls: "typ-base-removal-intro",
      text: "These columns don't belong to the TYP. Unchecked ones are kept.",
    });

    for (const id of this.columns) {
      new Setting(contentEl).setName(columnLabel(id)).addToggle((control) =>
        control.setValue(true).onChange((value) => {
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
}

function askRemovals(plugin, columns, viewName) {
  return new Promise((resolve) => new RemovalModal(plugin, columns, viewName, resolve).open());
}

module.exports = { askColumnOptions, askRemovals };
