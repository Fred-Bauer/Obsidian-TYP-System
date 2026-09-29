const { FuzzySuggestModal } = require("obsidian");
const { FIXED_SHORTCUTS, SCRIPT_PREFIX, shortcutLabel } = require("./shortcuts");

// Auswahl eines Shortcuts für eine Property des TYP-Frontmatters (Knopf bzw.
// Chip in der Property-Zeile, siehe type-frontmatter-editor.js). Ersetzt die
// frühere Legende unterhalb der Frontmatter-Blöcke: dieselben Token, aber am
// Ort der Verwendung, durchsuchbar - und bei Skripten zusätzlich mit der
// Beschreibung aus deren @typ-shortcut-Marker, die eine feste Legende gar nicht
// kennen konnte.
//
// Gewählt wird nie freier Text: die Liste ist die maßgebliche Quelle, ein
// Tippfehler im Skriptnamen ist damit ausgeschlossen.
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

  // Fuzzy-Suche greift auch auf die Beschreibung, nicht nur auf den Namen -
  // "Erstellungsdatum" findet so auch "created".
  getItemText(item) {
    const label = shortcutLabel(item);
    return item.description ? `${label} ${item.description}` : label;
  }

  renderSuggestion(match, el) {
    const item = match.item;
    el.addClass("fred-typ-shortcut-suggestion");
    el.createEl("code", { cls: "fred-typ-shortcut-suggestion-name", text: shortcutLabel(item) });
    if (item.description) el.createSpan({ cls: "fred-typ-shortcut-suggestion-desc", text: item.description });
  }

  // Siehe TypPickerModal in type-picker.js: Obsidians selectSuggestion() ruft
  // erst close() und danach erst onChooseItem() - "chosen" muss deshalb schon
  // hier gesetzt werden, sonst löst das von close() ausgelöste onClose() das
  // Promise vorzeitig mit null auf und die eigentliche Auswahl geht verloren.
  selectSuggestion(item, evt) {
    this.chosen = true;
    super.selectSuggestion(item, evt);
  }

  onChooseItem(item) {
    this.resolve({ name: item.name });
  }

  onClose() {
    super.onClose();
    if (!this.chosen) this.resolve(null);
  }
}

// Öffnet die Auswahl für die Property key. getScripts ist der Accessor aus
// registerShortcutScripts() (shortcut-scripts.js). Löst mit dem gewählten
// Shortcut-Record ({ name }) auf, oder mit null bei ESC/Abbruch.
function pickShortcut(app, key, getScripts) {
  return new Promise((resolve) => {
    const items = [
      ...FIXED_SHORTCUTS.map(({ name, description }) => ({ name, description })),
      ...getScripts().map(({ name, description }) => ({ name: SCRIPT_PREFIX + name, description })),
    ];
    new ShortcutPickerModal(app, key, items, resolve).open();
  });
}

module.exports = { pickShortcut };
