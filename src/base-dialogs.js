const { Modal, Setting } = require("obsidian");

/* ============================================================
 * Die beiden Dialoge der Base-Befehle (siehe bases.js)
 *  - Spalten-Optionen vor dem Anlegen/Aktualisieren
 *  - Bestätigung der Entfernungen beim Aktualisieren
 * ============================================================ */

const NOTE_PREFIX = "note.";

// Anzeigename einer Spalte: dieselbe verkürzte Form, in der die Property auch
// in der .base-Datei steht ("Titel" statt "note.Titel").
function columnLabel(id) {
  return id.startsWith(NOTE_PREFIX) ? id.slice(NOTE_PREFIX.length) : id;
}

function targetLabel(target) {
  if (!target.type) return `Subtyp ${target.subtype}`;
  return target.subtype ? `${target.type} / ${target.subtype}` : `TYP ${target.type}`;
}

/* --- Spalten-Optionen ---------------------------------------------------- */

// Drei Schalter, alle standardmäßig aus - der schmale Satz (file.name plus
// TYP-Frontmatter) ist der Normalfall. Darunter die Vorschau der Spalten, die
// dabei herauskommen; sie wird bei jeder Änderung neu berechnet, damit die
// Wirkung eines Schalters nicht erraten werden muss.
//
// "Alle Subtyp-Properties" erscheint nur bei einem TYP-Ziel: in einer
// Subtyp-View blieben die Properties der übrigen Subtypen durchweg leer.
class ColumnOptionsModal extends Modal {
  constructor(plugin, target, preview, resolve) {
    super(plugin.app);
    this.plugin = plugin;
    this.target = target;
    this.preview = preview;
    this.resolve = resolve;
    this.options = { floating: false, allSubtypes: false, tags: false };
    this.confirmed = false;
  }

  onOpen() {
    const { contentEl } = this;
    this.modalEl.addClass("fred-base-options-modal");
    this.titleEl.setText(`Spalten für ${targetLabel(this.target)}`);

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

    toggle("Floating Properties", "Die kursiv markierten Properties des Blocks mitnehmen.", "floating");
    if (!this.target.subtype) {
      toggle("Alle Subtyp-Properties", "Zusätzlich die Properties sämtlicher Subtyp-Blöcke dieses TYPs.", "allSubtypes");
    }
    toggle("tags", "Die tags-Property als eigene Spalte.", "tags");

    this.previewEl = contentEl.createDiv({ cls: "fred-base-preview" });
    this.renderPreview();

    const buttonRow = contentEl.createDiv({ cls: "modal-button-container" });
    buttonRow.createEl("button", { text: "Abbrechen" }).addEventListener("click", () => this.close());
    const confirm = buttonRow.createEl("button", { cls: "mod-cta", text: "Übernehmen" });
    confirm.addEventListener("click", () => {
      this.confirmed = true;
      this.close();
    });
  }

  renderPreview() {
    const ids = this.preview(this.options);
    this.previewEl.empty();
    this.previewEl.createDiv({ cls: "fred-base-preview-title", text: `${ids.length} Spalte(n)` });
    const list = this.previewEl.createDiv({ cls: "fred-base-preview-list" });
    for (const id of ids) list.createSpan({ cls: "fred-base-preview-column", text: columnLabel(id) });
  }

  onClose() {
    this.contentEl.empty();
    // ESC bzw. Klick daneben zählt wie Abbrechen - sonst liefe der Befehl mit
    // einer Auswahl weiter, die gar nicht bestätigt wurde.
    this.resolve(this.confirmed ? this.options : null);
  }
}

function askColumnOptions(plugin, target, preview) {
  return new Promise((resolve) => new ColumnOptionsModal(plugin, target, preview, resolve).open());
}

/* --- Entfernungen bestätigen --------------------------------------------- */

// Beim Aktualisieren laufen Ergänzen und Umsortieren stumm durch; nur das
// Entfernen wird vorgelegt, denn nur dort geht etwas verloren. Alle Einträge
// sind vorbelegt, einzeln abwählbar - eine abgewählte Spalte bleibt stehen
// (vorn, siehe updateActiveView).
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
    this.modalEl.addClass("fred-base-removal-modal");
    this.titleEl.setText(`Spalten entfernen aus "${this.viewName}"`);
    contentEl.createEl("p", {
      cls: "fred-base-removal-intro",
      text: "Diese Spalten gehören nicht zum TYP. Abgewählte bleiben stehen.",
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
    buttonRow.createEl("button", { text: "Abbrechen" }).addEventListener("click", () => this.close());
    const confirm = buttonRow.createEl("button", { cls: "mod-cta", text: "Übernehmen" });
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
