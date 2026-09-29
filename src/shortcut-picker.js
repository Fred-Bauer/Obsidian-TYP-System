const { FuzzySuggestModal, Modal, Setting } = require("obsidian");
const { FIXED_SHORTCUTS, SCRIPT_PREFIX, buildArgs } = require("./shortcuts");

// Anzeigeform eines Listeneintrags: der Name, bei einem Skript mit deklarierten
// Parametern zusätzlich deren Namen in Klammern - so ist schon in der Auswahl
// zu sehen, dass (und womit) ein Skript parametrisiert wird.
function itemLabel(item) {
  return item.params?.length > 0 ? `${item.name}(${item.params.join(", ")})` : item.name;
}

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
    const label = itemLabel(item);
    return item.description ? `${label} ${item.description}` : label;
  }

  renderSuggestion(match, el) {
    const item = match.item;
    el.addClass("fred-typ-shortcut-suggestion");
    el.createEl("code", { cls: "fred-typ-shortcut-suggestion-name", text: itemLabel(item) });
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
    this.resolve(item);
  }

  onClose() {
    super.onClose();
    if (!this.chosen) this.resolve(null);
  }
}

// Abfrage der Argumente eines Skripts, das welche deklariert hat - ein Dialog
// mit allen Feldern untereinander statt einer Kette von Einzelabfragen, damit
// man sie gemeinsam sieht und korrigieren kann. Die Felder sind nach den
// Parameternamen des Skripts benannt; vorbelegt werden sie mit den bereits
// gespeicherten Werten (vorhandene Argumente), sodass ein erneutes Wählen
// desselben Skripts zum Korrigieren einzelner Werte taugt.
//
// Ein leer gelassenes Feld gilt als "nicht gesetzt" und fällt aus dem Ergebnis
// heraus (siehe buildArgs in shortcuts.js) - deshalb gibt es hier keine
// Pflichtfelder und keine Validierung: was das Skript braucht, weiß nur das
// Skript selbst.
class ShortcutArgsModal extends Modal {
  constructor(app, item, vorhandene, resolve) {
    super(app);
    this.item = item;
    this.resolve = resolve;
    this.eingaben = {};
    for (const name of item.params) {
      const wert = vorhandene?.[name];
      this.eingaben[name] = wert === undefined || wert === null ? "" : String(wert);
    }
    this.bestaetigt = false;
  }

  onOpen() {
    this.titleEl.setText(`Argumente für ${this.item.name}`);
    if (this.item.description) {
      this.contentEl.createDiv({ cls: "fred-typ-shortcut-args-desc", text: this.item.description });
    }
    for (const name of this.item.params) {
      new Setting(this.contentEl).setName(name).addText((text) =>
        text
          .setValue(this.eingaben[name])
          .onChange((value) => {
            this.eingaben[name] = value;
          })
          // Enter in einem Feld schließt den Dialog ab, wie in Obsidians
          // eigenen Umbenennen-Dialogen.
          .inputEl.addEventListener("keydown", (event) => {
            if (event.key === "Enter" && !event.isComposing) {
              event.preventDefault();
              this.uebernehmen();
            }
          })
      );
    }
    new Setting(this.contentEl).addButton((button) =>
      button
        .setButtonText("Übernehmen")
        .setCta()
        .onClick(() => this.uebernehmen())
    );
  }

  uebernehmen() {
    this.bestaetigt = true;
    this.close();
  }

  onClose() {
    this.contentEl.empty();
    // ESC bzw. Klick daneben: kein Shortcut gesetzt, der bisherige bleibt
    // unangetastet - sonst wäre ein versehentliches Schließen ein stiller
    // Datenverlust.
    this.resolve(this.bestaetigt ? buildArgs(this.item.params, this.eingaben) : null);
  }
}

// Öffnet die Auswahl für die Property key. getScripts ist der Accessor aus
// registerShortcutScripts() (shortcut-scripts.js), vorhanden der aktuell
// gesetzte Shortcut-Record (für die Vorbelegung der Argumente). Löst mit dem
// neuen Record ({ name } bzw. { name, args }) auf, oder mit null bei Abbruch -
// auch dann, wenn zwar ein Skript gewählt, der Argument-Dialog danach aber
// abgebrochen wurde.
async function pickShortcut(app, key, getScripts, vorhanden = null) {
  const items = [
    ...FIXED_SHORTCUTS.map(({ name, description }) => ({ name, description, params: [] })),
    ...getScripts().map(({ name, params, description }) => ({ name: SCRIPT_PREFIX + name, params, description })),
  ];

  const item = await new Promise((resolve) => new ShortcutPickerModal(app, key, items, resolve).open());
  if (!item) return null;
  if (item.params.length === 0) return { name: item.name };

  // Vorbelegung nur, wenn dasselbe Skript schon gesetzt war - bei einem
  // Wechsel wären die alten Werte für andere Parameternamen bedeutungslos.
  const vorbelegung = vorhanden?.name === item.name ? vorhanden.args : null;
  const args = await new Promise((resolve) => new ShortcutArgsModal(app, item, vorbelegung, resolve).open());
  if (args === null) return null;
  return Object.keys(args).length > 0 ? { name: item.name, args } : { name: item.name };
}

module.exports = { pickShortcut };
