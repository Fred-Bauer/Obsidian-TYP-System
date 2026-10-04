const { ConfirmationModal, Platform } = require("obsidian");
const { nameColor, paintColorDot, DEFAULT_TYP_COLOR } = require("./typ-colors");

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

// Like appendTypName for a Subtyp of typ, in the Subtyp color (see nameColor
// in typ-colors.js, which also honors the "Subtyp" sub-toggle of "TYP-Pane").
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

module.exports = { ConfirmModal, appendTypName, appendSubtypName, typNameNode, subtypNameNode };
