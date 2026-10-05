const { ConfirmationModal, Platform } = require("obsidian");
const { nameColor, paintColorDot, DEFAULT_TYP_COLOR } = require("./typ-colors");

// A TYP name in running text (dialogs): colored when "TYP-Pane and -Picker"
// coloring is on (colorViews.typList), otherwise a dot before plain text - the
// same switch as in the picker and the list. The caller passes color so a
// rename can use the same (old) color for old and new name. color null = TYP
// without a color.
function appendTypName(parentEl, plugin, typ, color) {
  if (plugin.settings.colorViews.typList) {
    const nameEl = parentEl.createSpan({ cls: "typ-inline-name", text: typ });
    if (color) nameEl.style.color = color;
  } else {
    paintColorDot(parentEl.createSpan({ cls: "typ-inline-dot" }), color ?? DEFAULT_TYP_COLOR, !color);
    parentEl.createSpan({ cls: "typ-inline-name", text: typ });
  }
}

// Like appendTypName for a Subtyp of typ, in the Subtyp color (see nameColor
// in typ-colors.js, which also honors the "Subtyp" sub-toggle of "TYP-Pane
// and TYP-Picker").
// colorSubtyp is the Subtyp whose color is used - a rename shows the new name,
// which has no entry yet, in the old one's color. As with appendTypName, a TYP
// without a color leaves the text uncolored.
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

// The same as nodes for a ConfirmModal title or body.
const typNameNode = (plugin, typ, color) => createFragment((f) => appendTypName(f, plugin, typ, color));
const subtypNameNode = (plugin, typ, name, colorSubtyp = name) =>
  createFragment((f) => appendSubtypName(f, plugin, typ, name, colorSubtyp));

// Fills el with a string or an array of strings and nodes.
function appendParts(el, parts) {
  for (const part of Array.isArray(parts) ? parts : [parts]) {
    if (typeof part === "string") el.appendText(part);
    else el.appendChild(part);
  }
}

// The one confirmation dialog of the plugin, built on Obsidian's own
// ConfirmationModal - the base of its "Delete file" etc. - so look, button
// order [Cancel] [Action], bottom sheet on phones and keyboard focus match
// Obsidian's dialogs exactly.
//
// Like Obsidian's "Merge property ... with ...?" (All properties), the
// question itself is the title and the text only adds what the title doesn't
// say - often nothing.
//
//   title       - the question ("Delete TERMIN?"); a string or an array of
//                 strings and nodes (for colored names, see appendTypName/
//                 appendSubtypName)
//   body        - optional paragraphs, each shaped like title
//   confirmText - label of the action button
//   warning     - destructive action (red button)
//   focus       - "confirm" or "cancel": which button Enter triggers. Rename
//                 focuses the action, delete and merge focus Cancel.
//   onConfirm / onCancel - onCancel also covers Escape and a click outside.
//   dontAskAgain - optional: shows Obsidian's "Don't ask again" checkbox (as
//                 in its "Delete file", desktop only) and passes its state to
//                 onConfirm(dontAskAgain). Only for dialogs that may be
//                 switched off, i.e. actions that can be undone.
//
// Both callbacks run from onClose, i.e. once the dialog is gone - as before
// the switch to ConfirmationModal, and so a long onConfirm (rewriting many
// notes) neither keeps the dialog open nor runs twice.
class ConfirmModal extends ConfirmationModal {
  constructor(app, { title, body = [], confirmText, warning = false, focus = "confirm", dontAskAgain = false, onConfirm, onCancel }) {
    super(app);
    this.title = title;
    this.body = body;
    this.onConfirm = onConfirm;
    this.onCancel = onCancel;
    this.confirmed = false;
    this.dontAskAgain = false;

    // Before the buttons, so it sits on the left as in Obsidian's dialogs.
    if (dontAskAgain && !Platform.isMobile) {
      this.addCheckbox("Don't ask again", (checked) => {
        this.dontAskAgain = checked;
      });
    }

    // Buttons already here, not in onOpen: ConfirmationModal.open() looks for
    // the initial-focus button before it calls onOpen.
    this.addButton((button) => {
      button.setButtonText("Cancel").setCancel();
      if (focus === "cancel") button.setInitialFocus();
    });
    this.addButton((button) => {
      button.setButtonText(confirmText).setCta();
      if (warning) button.setDestructive();
      if (focus === "confirm") button.setInitialFocus();
      // Braces, no return value: ConfirmationButton keeps the dialog open if
      // the handler returns something truthy, and waits for a promise.
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
}

// "Rename and update notes": the name typed into a dialog that is the
// confirmation at the same time. Built like Obsidian's own "Rename file"
// dialog (a ConfirmationModal with .mod-file-rename and a one-line
// .rename-textarea, the old name selected, Enter submits), plus the text of
// a confirmation below the field, updated while typing.
//
//   title    - like ConfirmModal's ("Rename TERMIN")
//   value    - the current name, prefilled and selected
//   preview  - preview(text) for the typed text: { confirmText, warning,
//              body } as in ConfirmModal, plus ready - false while there is
//              nothing to submit (empty or unchanged name), which disables
//              the action button. Typing an existing name can switch
//              "Rename" to a red "Merge".
//   onSubmit - onSubmit(text), from onClose like ConfirmModal's onConfirm, so
//              a long run (rewriting many notes) doesn't keep the dialog open.
//
// Buttons [Cancel] [Action] like every other dialog of the plugin (see
// ConfirmModal); the field keeps the focus, Enter is the action button.
class RenameModal extends ConfirmationModal {
  constructor(app, { title, value, preview, onSubmit }) {
    super(app);
    this.title = title;
    this.preview = preview;
    this.onSubmit = onSubmit;
    this.submitted = null;
    this.state = null;
    this.addClass("mod-file-rename");

    const inputEl = (this.inputEl = createEl("textarea", { cls: "rename-textarea", attr: { rows: 1, spellcheck: "false" } }));
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
      // As in ConfirmModal: braces, no return value (a truthy one would keep
      // the dialog open). Disabled while there is nothing to submit.
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
}

module.exports = { ConfirmModal, RenameModal, appendTypName, appendSubtypName, typNameNode, subtypNameNode };
