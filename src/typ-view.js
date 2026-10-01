const { ItemView, Menu, Modal, Notice, setIcon, debounce } = require("obsidian");
const { mountFrontmatterBlocks } = require("./frontmatter-blocks");
const {
  normalizeSubtypeName,
  getSubtypeNames,
  ensureSubtype,
  moveTypeSubtypes,
  deleteTypeSubtypes,
  mergeTypeSubtypes,
  getSubtype,
  renameSubtype,
  reorderSubtypes,
  deleteSubtype,
  mergeSubtypes,
  renameSubtypeInNotes,
} = require("./subtypes");
const { normalizeTypeName, compareTypes, sortTypesByMode } = require("./type-utils");
const { typeKeyOf, propertyValue, setCanonicalProperty, TYP_PROPERTY, SUBTYP_PROPERTY } = require("./typ-index");
const {
  subtypeColor,
  applyColorOffset,
  hasColorOffset,
  subtypeHasOwnColor,
  paintColorDot,
  nameColor,
  channelBounds,
  clampedOffset,
  SUBTYPE_COLOR_CHANNELS,
  DEFAULT_TYPE_COLOR,
} = require("./type-colors");

const VIEW_TYPE_TYP = "fred-typ-view";
const DEFAULT_SORT_ORDER = "count-desc";
const DEFAULT_SECONDARY = "subtypes";

// Was in der TYP-Liste rechts neben dem Namen steht (settings.typListSecondary).
// Umgeschaltet wird nicht über die Einstellungen, sondern über einen Knopf im
// Listen-Header neben der Sortierung, der die Modi der Reihe nach durchschaltet
// (siehe cycleSecondary) - es sind zu wenige und zu unmittelbar sichtbare
// Zustaende fuer ein Menue.
//   subtypes    - die Subtypen des TYPs in Klammern, je in seiner Farbe
//                 (wie die Vorschau im separaten TYP-Picker, siehe
//                 renderSubtypePreview in type-picker.js)
//   description - Textfeld zur Bearbeitung der TYP-Beschreibung
//   none        - nichts, der Name bekommt die ganze Zeile
// Die Reihenfolge ist zugleich die des Durchschaltens, der erste Eintrag der
// Standard (DEFAULT_SECONDARY): die Subtypen stehen sonst nirgends in der
// Liste, die Beschreibung dagegen auch in der Detailansicht des TYPs.
const SECONDARY_MODES = [
  { mode: "subtypes", title: "Subtypen", icon: "list-tree" },
  { mode: "description", title: "Beschreibung", icon: "text-cursor-input" },
  { mode: "none", title: "Nichts", icon: "minus" },
];

const SORT_OPTIONS = [
  // Nutzt (anders als die übrigen Modi) keinen eigenen Vergleich, sondern die
  // Reihenfolge von plugin.settings.types selbst als Speicherort - siehe
  // render() und renderRegisteredItem() für das per Drag & Drop verschiebbare
  // Rendern, das genau darauf aufbaut. Bewusst als erste Option (siehe
  // showSortMenu) - eigene, oberste Gruppe im Menü statt einsortiert zwischen
  // die eigentlichen Sortierkriterien.
  { mode: "manual", title: "Manuell (Drag & Drop)" },
  { mode: "count-desc", title: "Häufigkeit (absteigend)" },
  { mode: "count-asc", title: "Häufigkeit (aufsteigend)" },
  { mode: "name-asc", title: "Name (A bis Z)" },
  { mode: "name-desc", title: "Name (Z bis A)" },
  { mode: "color-asc", title: "Farbe (Rot → Violett)" },
  { mode: "color-desc", title: "Farbe (Violett → Rot)" },
];

// Schreibt den TYP-Wert aller Notizen mit dem Schlüssel oldKey (siehe
// typeKeyOf in typ-index.js - für einen sauberen Wert der TYP-Name selbst,
// sonst die Rohform, z. B. " buch" oder "[PERSON, BUCH]") auf den Einzelwert
// newValue um. Genutzt für registerType() (Bereinigen), Umbenennen und
// Zusammenlegen. Der Abgleich erfolgt exakt über den Schlüssel, eine Liste
// wird dabei also als Ganzes ersetzt statt nur einer ihrer Einträge. Ein
// abweichend geschriebener Property-Name ("typ") wird dabei zu "TYP".
async function renameTypeInNotes(plugin, oldKey, newValue) {
  let changed = 0;
  for (const file of plugin.typIndex.filesWithType(oldKey)) {
    let matched = false;
    await plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
      if (typeKeyOf(propertyValue(frontmatter, TYP_PROPERTY)) !== oldKey) return;
      setCanonicalProperty(frontmatter, TYP_PROPERTY, newValue);
      matched = true;
    });
    if (matched) changed++;
  }
  return changed;
}

// Bereinigte Form eines Rohwerts für registerType(): Einzelwert getrimmt und
// groß geschrieben; eine Liste wird bewusst NICHT auf einen ihrer Einträge
// reduziert, sondern als Ganzes zu einem Einzelwert "A, B" (Rohform) - daraus
// lässt sich der TYP danach per Umbenennen gezielt in einen anderen überführen
// (siehe startDetailRename/showMergeConfirm). normalize: Schreibweise der
// einzelnen Namen - für Subtypen normalizeSubtypeName (siehe subtypes.js).
function normalizeRawType(raw, normalize = normalizeTypeName) {
  if (Array.isArray(raw)) {
    return raw
      .map((v) => normalize(String(v ?? "")))
      .filter(Boolean)
      .join(", ");
  }
  return normalize(String(raw));
}

// Anzeige eines unregistrierten Schlüssels: Randleerzeichen wären als reiner
// Text unsichtbar, daher dann in Anführungszeichen. Listen tragen ihre
// eckigen Klammern schon im Schlüssel.
function displayTypeKey(typeKey) {
  return typeKey !== typeKey.trim() ? `"${typeKey}"` : typeKey;
}

// TYP-Name in Fließtext (Bestätigungs-Modale): eingefärbter Name, wenn "TYP
// View einfärben" aktiv ist (colorViews.typList), sonst ein Farbpunkt davor
// plus normaler Text - dieselbe Umschaltung wie im TYP-Picker (siehe
// renderSuggestion in type-picker.js) und in der TYP-Liste selbst. color wird
// vom Aufrufer übergeben statt hier nachgeschlagen, damit z. B. bei einer
// Umbenennung bewusst für alt UND neu dieselbe (die des alten Namens, die nach
// dem Umbenennen erhalten bleibt) Farbe verwendet werden kann. color null =
// TYP ohne eigene Farbe (Name ungefärbt bzw. Punkt als hohler grauer Ring).
function appendTypeName(parentEl, plugin, type, color) {
  if (plugin.settings.colorViews.typList) {
    const nameEl = parentEl.createSpan({ cls: "fred-typ-inline-name", text: type });
    if (color) nameEl.style.color = color;
  } else {
    paintColorDot(parentEl.createSpan({ cls: "fred-typ-inline-dot" }), color ?? DEFAULT_TYPE_COLOR, !color);
    parentEl.createSpan({ cls: "fred-typ-inline-name", text: type });
  }
}

class ConfirmDeleteTypeModal extends Modal {
  constructor(plugin, type, onConfirm) {
    super(plugin.app);
    this.plugin = plugin;
    this.type = type;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    this.modalEl.addClass("fred-confirm-delete-modal");
    const p = contentEl.createEl("p");
    p.appendText("Typ ");
    appendTypeName(p, this.plugin, this.type, this.plugin.settings.typeColors[this.type] ?? null);
    p.appendText(" wirklich löschen?");

    const buttonRow = contentEl.createDiv({ cls: "modal-button-container" });
    buttonRow.createEl("button", { text: "Abbrechen" }).addEventListener("click", () => this.close());

    const confirmBtn = buttonRow.createEl("button", { cls: "mod-warning", text: "Löschen" });
    confirmBtn.addEventListener("click", () => {
      this.close();
      this.onConfirm();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

// Vor dem "Umbenennen (inkl. Notizen anpassen)"-Button (siehe renderTypeSettings
// und startDetailRename) - im Gegensatz zur normalen Umbenennung, die nur die
// Plugin-Einstellungen ändert, schreibt diese Variante zusätzlich den TYP-Wert
// aller betroffenen Notizen um. Das ist ein Bulk-Schreibvorgang über
// potenziell viele Dateien, daher hier eine explizite Bestätigung davor.
class ConfirmRenameTypeModal extends Modal {
  constructor(plugin, oldType, newType, affectedCount, onConfirm, onCancel) {
    super(plugin.app);
    this.plugin = plugin;
    this.oldType = oldType;
    this.newType = newType;
    this.affectedCount = affectedCount;
    this.onConfirm = onConfirm;
    this.onCancel = onCancel;
    this.confirmed = false;
  }

  onOpen() {
    const { contentEl } = this;
    this.modalEl.addClass("fred-confirm-delete-modal");
    // Dieselbe Farbe für alt und neu (die des alten Namens) - der neue Name
    // hat vor dem eigentlichen Umbenennen noch keinen eigenen Eintrag in
    // typeColors, übernimmt aber die Farbe des alten (siehe applyRename).
    const color = this.plugin.settings.typeColors[this.oldType] ?? null;
    const p = contentEl.createEl("p");
    p.appendText("TYP ");
    appendTypeName(p, this.plugin, this.oldType, color);
    p.appendText(" in ");
    appendTypeName(p, this.plugin, this.newType, color);
    p.appendText(` umbenennen und ${this.affectedCount} Notiz(en) entsprechend anpassen?`);

    const buttonRow = contentEl.createDiv({ cls: "modal-button-container" });
    buttonRow.createEl("button", { text: "Abbrechen" }).addEventListener("click", () => this.close());

    const confirmBtn = buttonRow.createEl("button", { cls: "mod-cta", text: "Umbenennen" });
    confirmBtn.addEventListener("click", () => {
      this.confirmed = true;
      this.close();
      this.onConfirm();
    });
  }

  // Deckt sowohl "Abbrechen"-Klick als auch Escape/Klick daneben ab - analog
  // zum Cancel-Handling in TypPickerModal.
  onClose() {
    this.contentEl.empty();
    if (!this.confirmed) this.onCancel?.();
  }
}

// Umbenennen auf den Namen eines bereits registrierten TYPs (siehe
// startDetailRename) - statt die Umbenennung stillschweigend zu verwerfen,
// anbieten, beide zusammenzulegen (siehe mergeType). Schreibt immer auch die
// Notizen um, unabhängig davon, über welchen der beiden Umbenennen-Buttons es
// ausgelöst wurde: ein Zusammenlegen nur in den Einstellungen ließe die
// Notizen des Quell-TYPs als unregistrierten Eintrag zurück.
class ConfirmMergeTypeModal extends ConfirmRenameTypeModal {
  onOpen() {
    const { contentEl } = this;
    this.modalEl.addClass("fred-confirm-delete-modal");
    const settings = this.plugin.settings;
    const p = contentEl.createEl("p");
    p.appendText("TYP ");
    appendTypeName(p, this.plugin, this.newType, settings.typeColors[this.newType] ?? null);
    p.appendText(" existiert bereits. ");
    appendTypeName(p, this.plugin, this.oldType, settings.typeColors[this.oldType] ?? null);
    p.appendText(" damit zusammenlegen?");

    contentEl.createEl("p", {
      text:
        `${this.affectedCount} Notiz(en) werden auf ${this.newType} umgestellt. ` +
        `Farbe, Beschreibung und TYP-Frontmatter von ${this.oldType} entfallen, ` +
        `seine Subtypen werden übernommen (gleichnamige Subtyp-Blöcke zusammengeführt).`,
    });

    const buttonRow = contentEl.createDiv({ cls: "modal-button-container" });
    buttonRow.createEl("button", { text: "Abbrechen" }).addEventListener("click", () => this.close());

    const confirmBtn = buttonRow.createEl("button", { cls: "mod-warning", text: "Zusammenlegen" });
    confirmBtn.addEventListener("click", () => {
      this.confirmed = true;
      this.close();
      this.onConfirm();
    });
  }
}

// Bestätigungen rund um Subtypen (siehe renderSectionFooter): schlichter Text
// statt eingefärbter TYP-Namen, sonst wie die TYP-Modale oben. onCancel greift
// wie dort auch bei Escape/Klick daneben.
class ConfirmSubtypeModal extends Modal {
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
    this.modalEl.addClass("fred-confirm-delete-modal");
    for (const text of this.paragraphs) contentEl.createEl("p", { text });

    const buttonRow = contentEl.createDiv({ cls: "modal-button-container" });
    buttonRow.createEl("button", { text: "Abbrechen" }).addEventListener("click", () => this.close());

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

class TypView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_TYP;
  }

  getDisplayText() {
    return "TYP";
  }

  getIcon() {
    return "shapes";
  }

  async onOpen() {
    this.isEditing = false;
    this.selectedType = null;
    this.frontmatterBlocks = null;
    this.frontmatterEditors = [];

    this.contentEl.empty();
    this.contentEl.addClass("fred-typ-view");

    this.registerDomEvent(this.contentEl, "keydown", (event) => {
      if (event.key === "Escape" && this.selectedType !== null) this.closeTypeSettings();
    });
    this.render();
  }

  async onClose() {
    this.closeSubtypeColorPopover?.();
  }

  openSearch(type) {
    const globalSearch = this.plugin.app.internalPlugins.getPluginById("global-search");
    if (!globalSearch) return;
    // "kein Typ" träfe ohne Filter auch alle Nicht-Markdown-Dateien (die naturgemäß
    // nie eine Frontmatter-Property haben können) - daher explizit auf .md eingrenzen.
    // Für eine Liste (unregistrierter Schlüssel "[A, B]") gibt es keine exakte
    // Suchsyntax - dann nach Notizen suchen, die alle ihre Einträge tragen.
    const query = type === null ? `-["${TYP_PROPERTY}"] file:.md` : this.typeClause(type);
    globalSearch.instance.openGlobalSearch(query);
  }

  // Suchklausel für einen TYP-Schlüssel. Für eine Liste (unregistrierter
  // Schlüssel "[A, B]") gibt es keine exakte Suchsyntax - dann nach Notizen
  // suchen, die alle ihre Einträge tragen. Auch von openSubtypeSearch()
  // genutzt: seit die nicht erfassten Subtypen in der Liste stehen, kann dort
  // auch ein nicht erfasster (und damit unsauberer) TYP-Schlüssel ankommen.
  typeClause(type) {
    const raw = this.plugin.typIndex.rawValueOf(type);
    return Array.isArray(raw)
      ? raw.map((v) => `["${TYP_PROPERTY}":"${String(v ?? "").trim()}"]`).join(" ")
      : `["${TYP_PROPERTY}":"${type}"]`;
  }

  // typeKey kommt 1:1 aus den tatsächlichen Frontmatter-Werten (siehe
  // unregisteredRows in render() und typeKeyOf in typ-index.js) - kann also
  // klein geschrieben sein, Randleerzeichen tragen oder eine Liste sein. TYPen
  // werden aber immer als sauberer Einzelwert in Großbuchstaben geführt -
  // registriert wird deshalb die bereinigte Form (siehe normalizeRawType), und
  // die betroffenen Notizen werden gleich mit umgeschrieben, damit sie nicht
  // weiterhin als "nicht registriert" auftauchen.
  async registerType(typeKey) {
    const result = await this.applyTypeRegistration(typeKey);
    if (!result) return;

    await this.plugin.saveSettings();
    this.render();
    this.plugin.refreshTypColors?.();

    if (result.renamed > 0) {
      new Notice(`TYP ${result.type} registriert, ${result.renamed} Notiz(en) angepasst.`);
    }
  }

  // Der eigentliche Vorgang aus registerType(), ohne Speichern, Neuzeichnen
  // und Notice: so kann registerTypeWithSubtype() TYP und Subtyp nacheinander
  // eintragen und danach EINMAL speichern und EINE Notice zeigen, statt zweimal.
  // Liefert { type, renamed } oder null, wenn nichts Brauchbares übrig bleibt.
  async applyTypeRegistration(typeKey) {
    const raw = this.plugin.typIndex.rawValueOf(typeKey);
    const normalized = normalizeRawType(raw === undefined ? typeKey : raw);
    if (!normalized) return null;
    if (!this.plugin.settings.types.includes(normalized)) {
      this.plugin.settings.types.push(normalized);
    }
    const renamed = normalized !== typeKey ? await renameTypeInNotes(this.plugin, typeKey, normalized) : 0;
    return { type: normalized, renamed };
  }

  // Neues, leeres Tree-Item anlegen und sofort in den Editier-Modus versetzen -
  // wie bei Obsidians eigenen Views (z. B. neue Bookmark-Gruppe).
  startAdd() {
    if (this.isEditing) return;

    const treeItem = this.listEl.createDiv({ cls: "tree-item" });
    if (this.separatorEl) this.listEl.insertBefore(treeItem, this.separatorEl);
    const self = treeItem.createDiv({ cls: "tree-item-self is-clickable" });
    const inner = self.createDiv({ cls: "tree-item-inner" });

    this.startEditing(null, self, inner);
  }

  // Wie Obsidians eigene Tree-Items: kein zusätzliches Input-Element, sondern
  // das bestehende Text-Element wird selbst editierbar (contenteditable).
  // type === null → neuer Eintrag, sonst Umbenennen des übergebenen Typs.
  startEditing(type, self, inner) {
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

      const value = normalizeTypeName(inner.textContent);
      if (commit && value && value !== type) {
        const exists = this.plugin.settings.types.some(
          (t) => t.toLowerCase() === value.toLowerCase() && t !== type
        );
        if (!exists) {
          if (type === null) {
            this.plugin.settings.types.push(value);
          } else {
            const idx = this.plugin.settings.types.indexOf(type);
            if (idx !== -1) this.plugin.settings.types[idx] = value;
            if (this.plugin.settings.typeColors[type] !== undefined) {
              this.plugin.settings.typeColors[value] = this.plugin.settings.typeColors[type];
              delete this.plugin.settings.typeColors[type];
            }
            if (this.plugin.settings.typeDescriptions[type] !== undefined) {
              this.plugin.settings.typeDescriptions[value] = this.plugin.settings.typeDescriptions[type];
              delete this.plugin.settings.typeDescriptions[type];
            }
            if (this.plugin.settings.typeDefaultFrontmatter[type] !== undefined) {
              this.plugin.settings.typeDefaultFrontmatter[value] = this.plugin.settings.typeDefaultFrontmatter[type];
              delete this.plugin.settings.typeDefaultFrontmatter[type];
            }
            if (this.plugin.settings.typeFloatingKeys[type] !== undefined) {
              this.plugin.settings.typeFloatingKeys[value] = this.plugin.settings.typeFloatingKeys[type];
              delete this.plugin.settings.typeFloatingKeys[type];
            }
            if (this.plugin.settings.typeShortcuts[type] !== undefined) {
              this.plugin.settings.typeShortcuts[value] = this.plugin.settings.typeShortcuts[type];
              delete this.plugin.settings.typeShortcuts[type];
            }
            if (this.ensureTypeManual()[type] !== undefined) {
              this.plugin.settings.typeManual[value] = this.plugin.settings.typeManual[type];
              delete this.plugin.settings.typeManual[type];
            }
            moveTypeSubtypes(this.plugin.settings, type, value);
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

  openTypeSettings(type) {
    this.selectedType = type;
    this.render();
  }

  closeTypeSettings() {
    this.selectedType = null;
    this.render();
  }

  // Wird als Component-Child geladen (siehe mountFrontmatterEditor) und muss
  // deshalb vor jedem Neuaufbau der Detail-Ansicht explizit entladen werden -
  // contentEl.empty() allein würde nur die DOM-Elemente entfernen, nicht aber
  // den darauf registrierten metadataTypeManager-Listener der Editor-Instanz.
  // frontmatterBlocks ist die Steuerung über alle Blöcke (u. a. für den
  // Befehl "Standard-Property hinzufügen"), frontmatterEditors alle Editoren
  // der Detailansicht inkl. der Subtyp-Blöcke.
  destroyFrontmatterEditor() {
    for (const editor of this.frontmatterEditors ?? []) this.removeChild(editor);
    this.frontmatterEditors = [];
    this.frontmatterBlocks = null;
  }

  render() {
    // Reentrancy-Guard: renderTypeSettings() löst am Ende selbst
    // plugin.refreshTypColors() aus (siehe dortiger Kommentar), was u. a.
    // über registerTypView wiederum render() auf allen TYP-View-Leaves
    // aufruft - inklusive diesem, während es noch mitten in genau diesem
    // Aufruf steckt. Ohne Guard rekursiert das synchron ohne Abbruch bis
    // zum Stack Overflow, bei jedem Öffnen/Umbenennen eines TYPs.
    if (this._rendering) return;
    this._rendering = true;
    try {
      this.destroyFrontmatterEditor();
      if (this.selectedType !== null) {
        this.renderTypeSettings(this.selectedType);
        return;
      }

      const { contentEl } = this;
      contentEl.empty();

      const { counts, noType } = this.plugin.typIndex.typeCounts();
      const registered = this.plugin.settings.types;
      const typeColors = this.plugin.settings.typeColors;
      const sortOrder = this.plugin.settings.typSortOrder ?? DEFAULT_SORT_ORDER;
      const isManualSort = sortOrder === "manual";
      const byCurrentOrder = (a, b) => compareTypes(sortOrder, a, b, counts, typeColors);

      this.renderListHeader(contentEl);

      const unregisteredRows = [...counts.keys()]
        .filter((type) => !registered.includes(type))
        .sort(byCurrentOrder)
        .map((type) => ({ type, count: counts.get(type) ?? 0 }));
      const unregisteredSubtypeRows = this.unregisteredSubtypeRows();

      // Ohne zweite Spalte darf der Name die ganze Zeile nehmen (siehe
      // .fred-typ-list-no-secondary in styles.css).
      const listCls = "fred-typ-list nav-files-container" + (this.secondaryMode() === "none" ? " fred-typ-list-no-secondary" : "");
      this.listEl = contentEl.createDiv({ cls: listCls });
      this.separatorEl = null;

      // sortTypesByMode() lässt im Manuell-Modus bewusst die Reihenfolge von
      // plugin.settings.types unangetastet - per Drag & Drop in
      // renderRegisteredItem() umsortiert. Der index wird dafür 1:1 als
      // Position in dieser (in diesem Modus unveränderten) Reihenfolge
      // weitergegeben.
      const registeredOrder = sortTypesByMode(registered, sortOrder, counts, typeColors);
      registeredOrder.forEach((type, index) => {
        this.renderRegisteredItem(type, counts.get(type) ?? 0, { draggable: isManualSort, index });
      });

      // Unterhalb der Trennlinie drei Abschnitte, jeder für sich optional:
      // nicht erfasste TYPen, nicht erfasste Subtypen, "[KEIN TYP]". Die
      // Subtypen bekommen eine eigene Trennlinie, weil sie nach einer anderen
      // Regel sortiert sind als die TYPen darüber (Anzahl statt Sortier-Button,
      // siehe unregisteredSubtypeRows) - ohne sichtbaren Schnitt sähe das nach
      // kaputter Sortierung aus. "[KEIN TYP]" ist kein echter Typ, nimmt an
      // keiner Sortierung teil und steht unabhängig von seiner Anzahl zuletzt;
      // es schließt direkt an, statt eine dritte Linie zu bekommen.
      //
      // this.separatorEl bleibt bewusst die ERSTE Linie: startAdd() hängt das
      // neue Tree-Item davor, und ein neuer TYP gehört ans Ende der erfassten,
      // nicht zwischen die nicht erfassten Abschnitte.
      const separator = () => {
        const el = this.listEl.createDiv({ cls: "fred-typ-separator" });
        this.separatorEl = this.separatorEl ?? el;
      };

      if (unregisteredRows.length > 0 || unregisteredSubtypeRows.length > 0 || noType > 0) separator();
      for (const row of unregisteredRows) this.renderUnregisteredItem(row.type, row.count);

      if (unregisteredSubtypeRows.length > 0) {
        if (unregisteredRows.length > 0) separator();
        for (const row of unregisteredSubtypeRows) this.renderUnregisteredSubtypeItem(row);
      }

      if (noType > 0) this.renderNoTypeItem(noType);
    } finally {
      this._rendering = false;
    }
  }

  // Wie der "Change sort order"-Button in Obsidians Tags- bzw. All-Properties-View.
  renderListHeader(contentEl) {
    const header = contentEl.createDiv({ cls: "nav-header" });
    const buttonsContainer = header.createDiv({ cls: "nav-buttons-container" });

    const addBtn = buttonsContainer.createDiv({
      cls: "clickable-icon nav-action-button",
      attr: { "aria-label": "Neuen Typ hinzufügen" },
    });
    setIcon(addBtn, "plus");
    addBtn.addEventListener("click", () => this.startAdd());

    const sortBtn = buttonsContainer.createDiv({
      cls: "clickable-icon nav-action-button",
      attr: { "aria-label": "Sortierreihenfolge ändern" },
    });
    setIcon(sortBtn, "lucide-sort-asc");
    sortBtn.addEventListener("click", (event) => this.showSortMenu(event));

    // Zweite Spalte: bewusst kein Menue, sondern ein Knopf, der die drei Modi
    // der Reihe nach durchschaltet - bei so wenigen Zustaenden, deren Wirkung
    // direkt darunter sichtbar wird, ist Durchklicken schneller als Aufklappen
    // und Auswaehlen. Icon und Tooltip zeigen den aktuellen Modus.
    const current = SECONDARY_MODES[this.secondaryIndex()];
    const secondaryBtn = buttonsContainer.createDiv({
      cls: "clickable-icon nav-action-button",
      attr: { "aria-label": `Neben dem Namen: ${current.title}` },
    });
    setIcon(secondaryBtn, current.icon);
    secondaryBtn.addEventListener("click", () => this.cycleSecondary());
  }

  // settings.typListSecondary, aber immer ein gueltiger Modus - Bestandsdaten
  // kennen den Schluessel noch nicht (siehe migrateTypListSecondary in main.js),
  // und ein spaeter entfernter Modus soll die Liste nicht leer lassen.
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
    // Wie im Sortier-Menue: nur neu zeichnen. Der Modus betrifft ausschliesslich
    // diese Liste, nicht die Einfaerbung anderswo - refreshTypColors waere hier
    // also nur ein unnoetiges Rundum-Neuzeichnen aller Ansichten.
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

  renderNoTypeItem(count) {
    const treeItem = this.listEl.createDiv({ cls: "tree-item" });
    const self = treeItem.createDiv({ cls: "tree-item-self is-clickable fred-typ-unregistered" });
    self.createDiv({ cls: "tree-item-inner", text: "[KEIN TYP]" });
    this.renderCountFlair(self, count);

    self.addEventListener("click", () => this.openSearch(null));
    self.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.openSearch(null);
    });
  }

  // Chromiums input[type=color] hat einen eigenen Mindest-Swatch, der sich nicht
  // unter Textgröße skalieren lässt - daher nur als unsichtbaren Picker-Trigger
  // über dem frei skalierbaren Punkt platzieren. Ohne eigene Farbe steht der
  // Punkt als hohler grauer Ring da (siehe paintColorDot); mit showReset
  // (Detailansicht) nennt ein Tooltip den Zustand, und der Zurücksetzen-Button
  // ist dann ausgegraut.
  renderColorPicker(parent, type, onChange, { showReset = false } = {}) {
    const currentColor = this.plugin.settings.typeColors[type] ?? DEFAULT_TYPE_COLOR;
    const colorWrap = parent.createDiv({ cls: "fred-typ-color-wrap" });
    const colorDot = colorWrap.createDiv({ cls: "fred-typ-color-dot" });
    let resetBtn = null;
    const showState = (color, isDefault) => {
      paintColorDot(colorDot, color, isDefault);
      if (!showReset) return;
      colorWrap.setAttribute("aria-label", isDefault ? "Standard (keine Farbe)" : "Farbe ändern");
      resetBtn?.toggleClass("is-disabled", isDefault);
    };

    const colorInput = colorWrap.createEl("input", { type: "color", cls: "fred-typ-color-input" });
    colorInput.value = currentColor;
    colorInput.addEventListener("click", (event) => event.stopPropagation());

    // "input" feuert bei jeder Zwischenfarbe, während der native Picker noch
    // offen ist - hier nur lokale Vorschau (Punkt, ggf. Name via onChange), ohne
    // die übrigen Views (Datei-Explorer, Graph, ...) neu zu rendern:
    // refreshTypColors() löst dafür u. a. render() auf dieser TYP-View selbst
    // aus, was dieses <input type=color> aus dem DOM entfernen und den nativen
    // Picker damit sofort schließen würde - noch bevor man überhaupt eine Farbe
    // auswählen kann (schon beim ersten Klick, vor dem Loslassen der Taste).
    colorInput.addEventListener("input", async () => {
      showState(colorInput.value, false);
      this.plugin.settings.typeColors[type] = colorInput.value;
      await this.plugin.saveSettings();
      onChange?.(colorInput.value);
    });

    // Erst wenn die Auswahl bestätigt und der native Picker dadurch geschlossen
    // wird, die übrigen Views nachziehen - an dem Punkt kann ein Neu-Rendern
    // dieser TYP-View selbst nichts mehr kaputt machen.
    colorInput.addEventListener("change", () => this.plugin.refreshTypColors?.());

    if (showReset) {
      resetBtn = parent.createDiv({
        cls: "clickable-icon fred-typ-color-reset",
        attr: { "aria-label": "Farbe zurücksetzen" },
      });
      setIcon(resetBtn, "rotate-ccw");
      resetBtn.addEventListener("click", async () => {
        delete this.plugin.settings.typeColors[type];
        colorInput.value = DEFAULT_TYPE_COLOR;
        showState(DEFAULT_TYPE_COLOR, true);
        await this.plugin.saveSettings();
        this.plugin.refreshTypColors?.();
        onChange?.(DEFAULT_TYPE_COLOR);
      });
    }
    showState(currentColor, this.plugin.settings.typeColors[type] === undefined);

    return colorWrap;
  }

  // Fängt Bestandsinstallationen ab, deren settings-Objekt schon vor Einführung
  // von typeManual geladen wurde (z. B. laufende Session vor einem vollständigen
  // Plugin-Reload nach Hot-Reload) - ohne das würde jeder Zugriff unten mit
  // "Cannot read properties of undefined" abbrechen und dabei den gesamten
  // restlichen renderTypeSettings()-Aufruf (Farbe, Beschreibung, Frontmatter)
  // mit sich reißen, da der Fehler synchron mitten in der Funktion auftritt.
  ensureTypeManual() {
    if (!this.plugin.settings.typeManual) this.plugin.settings.typeManual = {};
    return this.plugin.settings.typeManual;
  }

  // Ein Icon-Knopf statt eines beschrifteten Schalters: die Einstellung ist zu
  // klein, um mit Label und Toggle so viel Platz und Aufmerksamkeit zu
  // bekommen wie das Beschreibungsfeld darunter. Zustand wie bei den übrigen
  // Icon-Knöpfen der Ansicht über eine Klasse (is-active, siehe styles.css),
  // der Sinn steht im Tooltip - role/aria-checked halten ihn trotzdem als
  // Schalter lesbar.
  //
  // Standardmäßig an - daher wird (wie bei den anderen typeXxx-Dicts) nur die
  // Abweichung vom Default gespeichert, hier also nur "aus" (false); fehlender
  // Eintrag bzw. true bedeuten "an". Steuert, ob ein TYP in getTypes() (siehe
  // main.js) exportiert wird, siehe dortiger Kommentar.
  renderManualToggle(parent, type) {
    const btn = parent.createDiv({
      cls: "clickable-icon fred-typ-manual-icon",
      attr: { tabindex: "0", role: "checkbox" },
    });
    setIcon(btn, "file-pen-line");

    const showState = (on) => {
      btn.toggleClass("is-active", on);
      btn.setAttribute("aria-checked", String(on));
      btn.setAttribute("aria-label", on ? "Manuell erstellbar" : "Nicht manuell erstellbar");
    };
    showState(this.ensureTypeManual()[type] !== false);

    const toggle = async () => {
      const next = !btn.hasClass("is-active");
      showState(next);
      if (next) delete this.ensureTypeManual()[type];
      else this.ensureTypeManual()[type] = false;
      await this.plugin.saveSettings();
    };

    btn.addEventListener("click", toggle);
    btn.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggle();
      }
    });

    return btn;
  }

  renderRegisteredItem(type, count, { draggable = false, index = -1 } = {}) {
    const treeItem = this.listEl.createDiv({ cls: "tree-item" });
    const self = treeItem.createDiv({ cls: "tree-item-self is-clickable" });

    let nameEl;
    this.renderColorPicker(self, type, (newColor) => {
      if (nameEl && this.plugin.settings.colorViews.typList) nameEl.style.color = newColor;
    });

    nameEl = self.createDiv({ cls: "tree-item-inner", text: type });
    const color = this.plugin.settings.colorViews.typList ? this.plugin.settings.typeColors[type] : null;
    if (color) nameEl.style.color = color;

    // Zweite Spalte, umgeschaltet ueber den Knopf im Listen-Header (siehe
    // SECONDARY_MODES und cycleSecondary).
    const secondary = this.secondaryMode();
    if (secondary === "description") this.renderDescriptionInput(self, type);
    else if (secondary === "subtypes") this.renderSubtypePreview(self, type);

    this.renderCountFlair(self, count);

    self.addEventListener("click", () => {
      if (this.isEditing) return;
      this.openTypeSettings(type);
    });
    self.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.openSearch(type);
    });

    // Nur im Manuell-Sortiermodus aktiv (siehe render()) - die ganze Zeile ist
    // dann per Drag & Drop verschiebbar (ein Drag, der auf dem Farbpunkt oder
    // im Beschreibungsfeld beginnt, greift trotzdem nicht - diese Elemente
    // nehmen den Mousedown selbst für Farb-/Textauswahl). Verschoben wird
    // direkt in plugin.settings.types - dieselbe Liste, die im Manuell-Modus
    // unsortiert als Anzeigereihenfolge dient (siehe render()).
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

        const types = this.plugin.settings.types;
        const [moved] = types.splice(fromIndex, 1);
        types.splice(insertBefore, 0, moved);
        await this.plugin.saveSettings();
        this.render();
      });
    }
  }

  // Echtes Text-Input statt nur Anzeige: die Beschreibung ist direkt in der
  // Liste bearbeitbar, ohne dafür erst die Detailansicht öffnen zu müssen.
  // click hier muss die Zeile selbst gezielt NICHT auslösen
  // (self.addEventListener("click", ...) in renderRegisteredItem öffnet sonst
  // die Detailansicht), daher stopPropagation.
  renderDescriptionInput(self, type) {
    const descInput = self.createEl("input", {
      type: "text",
      cls: "fred-typ-list-description-input",
    });
    descInput.value = this.plugin.settings.typeDescriptions[type] ?? "";
    descInput.addEventListener("click", (event) => event.stopPropagation());
    descInput.addEventListener("change", async () => {
      const value = descInput.value.trim();
      if (value) this.plugin.settings.typeDescriptions[type] = value;
      else delete this.plugin.settings.typeDescriptions[type];
      await this.plugin.saveSettings();
    });
  }

  // "(Subtyp 1, Subtyp 2)" statt der Beschreibung - dieselbe Darstellung wie
  // die Subtyp-Vorschau im separaten TYP-Picker (renderSubtypePreview in
  // type-picker.js, gemeinsame Farbgrundlage nameColor in type-colors.js):
  // Klammern und Kommas muted, jeder Name in seiner eigenen Subtyp-Farbe; ohne
  // "TYP View einfärben" bleibt die Vorschau wie der TYP-Name selbst ungefärbt,
  // und ohne dessen Unter-Schalter "Subtyp" stehen alle in der TYP-Farbe.
  // Bewusst nur die erfassten Subtypen und ohne Notiz-Anzahl: nicht erfasste
  // Werte haben weder Farbe noch Definition, und Zahlen je Name würden die
  // Zeile so verlängern, dass bei mehreren Subtypen nichts mehr davon zu lesen
  // wäre. Reine Anzeige - Klick und Rechtsklick gehören weiter der ganzen
  // Zeile (Detailansicht bzw. Suche). Ob die Liste links hinter dem Namen
  // beginnt oder rechtsbündig vor der Anzahl endet, ist hier bewusst nicht
  // abgefragt: das schaltet Style Settings über eine body-Klasse (siehe den
  // @settings-Block und .fred-typ-list-subtypes in styles.css), das Markup
  // bleibt in beiden Fällen dasselbe.
  renderSubtypePreview(self, type) {
    const subtypes = getSubtypeNames(this.plugin.settings, type);
    if (subtypes.length === 0) return;

    const colorize = this.plugin.settings.colorViews.typList;
    const wrap = self.createSpan({ cls: "fred-typ-list-subtypes" });
    wrap.appendText("(");
    subtypes.forEach((subtype, index) => {
      if (index > 0) wrap.appendText(", ");
      const span = wrap.createSpan({ text: subtype });
      if (colorize) span.style.color = nameColor(this.plugin.settings, type, subtype).color;
    });
    wrap.appendText(")");
  }

  renderUnregisteredItem(type, count) {
    const treeItem = this.listEl.createDiv({ cls: "tree-item" });
    const self = treeItem.createDiv({ cls: "tree-item-self is-clickable fred-typ-unregistered" });
    self.createDiv({ cls: "tree-item-inner", text: displayTypeKey(type) });
    this.renderCountFlair(self, count);

    self.addEventListener("click", () => this.registerType(type));
    self.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.openSearch(type);
    });
  }

  // Alle SUBTYP-Werte, die in Notizen vorkommen, aber unter ihrem TYP nicht
  // erfasst sind - über den ganzen Vault, nicht nur für einen TYP wie
  // renderUnregisteredSubtypes() in der Detailansicht. Der Index führt seine
  // Buckets über ALLE TYP-Schlüssel, also auch über nicht erfasste; deren
  // Subtypen kommen daher mit (Klick erfasst dann beides, siehe
  // registerTypeWithSubtype).
  //
  // Sortiert nach Anzahl, dann nach dem Zeilentext von links nach rechts (erst
  // TYP, dann Subtyp) - dieselbe Regel wie in der Detailansicht, wo das
  // Häufigste oben steht. Bewusst NICHT nach dem Sortier-Button der Liste:
  // "Farbe" und "Manuell" haben für nicht erfasste Werte keine Bedeutung.
  //
  // Eine Notiz ohne TYP bleibt außen vor - der Index verwirft ihren SUBTYP
  // schon beim Zählen (siehe aggregate() in typ-index.js), ein SUBTYP ohne TYP
  // hat keinen Kontext.
  unregisteredSubtypeRows() {
    const registered = this.plugin.settings.types;
    const rows = [];
    for (const [type, bucket] of this.plugin.typIndex.subtypeCounts()) {
      const known = getSubtypeNames(this.plugin.settings, type);
      for (const [subtype, count] of bucket.counts) {
        if (known.includes(subtype)) continue;
        rows.push({ type, subtype, count, typeRegistered: registered.includes(type) });
      }
    }
    return rows.sort((a, b) => b.count - a.count || a.type.localeCompare(b.type) || a.subtype.localeCompare(b.subtype));
  }

  // "NOTIZ / Kurz Geschichte" - der Subtyp allein wäre mehrdeutig, denselben
  // Namen kann es unter mehreren TYPen geben. Ist der TYP bereits erfasst,
  // trägt sein Teil der Zeile seine Farbe (bzw. einen Farbpunkt davor, je nach
  // Einstellung "TYP View einfärben") - abgeschwächt über das Style Setting
  // "Farbe erfasster TYPen in dieser Liste", damit die Zeilen trotz Farbe
  // hinter den erfassten TYPen oben zurückbleiben. Ist auch der TYP nicht
  // erfasst, bleibt die ganze Zeile muted wie die Einträge darüber.
  renderUnregisteredSubtypeItem({ type, subtype, count, typeRegistered }) {
    const treeItem = this.listEl.createDiv({ cls: "tree-item" });
    const self = treeItem.createDiv({ cls: "tree-item-self is-clickable fred-typ-unregistered" });

    const colorize = this.plugin.settings.colorViews.typList;
    const { color, isDefault } = nameColor(this.plugin.settings, type);
    if (typeRegistered && !colorize) {
      const wrap = self.createDiv({ cls: "fred-typ-color-wrap fred-typ-unregistered-subtype-color" });
      paintColorDot(wrap.createDiv({ cls: "fred-typ-color-dot" }), color, isDefault);
    }

    const inner = self.createDiv({ cls: "tree-item-inner" });
    const typeEl = inner.createSpan({ cls: "fred-typ-unregistered-subtype-type", text: displayTypeKey(type) });
    if (typeRegistered && colorize && !isDefault) {
      typeEl.style.color = color;
      typeEl.addClass("fred-typ-unregistered-subtype-color");
    }
    inner.createSpan({ cls: "fred-typ-unregistered-subtype-slash", text: " / " });
    inner.createSpan({ text: displayTypeKey(subtype) });

    this.renderCountFlair(self, count);

    self.addEventListener("click", () => this.registerTypeWithSubtype(type, subtype));
    self.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.openSubtypeSearch(type, subtype);
    });
  }

  // Klick auf eine solche Zeile: erfasst den Subtyp - und, falls nötig, seinen
  // TYP gleich mit. Reihenfolge zwingend erst TYP, dann Subtyp: das Erfassen
  // eines TYPs kann dessen Wert in den Notizen bereinigen (" buch" → "BUCH"),
  // danach muss der Subtyp-Abgleich schon den NEUEN TYP-Namen verwenden, sonst
  // findet renameSubtypeInNotes() keine Datei mehr.
  //
  // Beides zusammen wird direkt ausgeführt, ohne Bestätigung: es ist eine
  // reine Erfassung. Notizen ändern sich nur, wenn der Rohwert unsauber war und
  // dabei bereinigt wird - ein sauberer Wert fasst keine einzige Datei an.
  async registerTypeWithSubtype(typeKey, subtypeKey) {
    const bucket = this.plugin.typIndex.subtypeBucket(typeKey);
    const typeResult = this.plugin.settings.types.includes(typeKey)
      ? { type: typeKey, renamed: 0 }
      : await this.applyTypeRegistration(typeKey);
    if (!typeResult) return;

    const subtypeResult = await this.applySubtypeRegistration(typeResult.type, subtypeKey, bucket);
    await this.plugin.saveSettings();
    this.render();
    this.plugin.refreshTypColors?.();

    if (!subtypeResult) return;
    const parts = [];
    if (typeResult.type !== typeKey) parts.push(`TYP ${typeResult.type}`);
    parts.push(`SUBTYP ${subtypeResult.subtype}`);
    const changed = typeResult.renamed + subtypeResult.renamed;
    new Notice(`${parts.join(" und ")} registriert${changed > 0 ? `, ${changed} Notiz(en) angepasst` : ""}.`);
  }

  renderTypeSettings(type) {
    const { contentEl } = this;
    contentEl.empty();

    const header = contentEl.createDiv({ cls: "fred-typ-detail-header" });
    const backBtn = header.createDiv({ cls: "clickable-icon fred-typ-back", attr: { "aria-label": "Zurück" } });
    setIcon(backBtn, "arrow-left");
    backBtn.addEventListener("click", () => this.closeTypeSettings());

    const titleEl = header.createDiv({ cls: "fred-typ-detail-title", text: type });
    const titleColor = this.plugin.settings.colorViews.typList ? this.plugin.settings.typeColors[type] : null;
    // Die TYP-Farbe bewusst als Custom Property statt direkt als color: eine
    // Inline-Farbe schlägt jede Stylesheet-Regel, die Akzentfarbe beim Hovern
    // (siehe .fred-typ-searchable) käme sonst nur mit !important dagegen an.
    if (titleColor) titleEl.style.setProperty("--fred-typ-name-color", titleColor);
    this.makeSearchable(titleEl, () => this.openSearch(type));

    const { counts } = this.plugin.typIndex.typeCounts();
    header.createSpan({ cls: "fred-typ-detail-count", text: String(counts.get(type) ?? 0) });

    // Links neben dem normalen Umbenennen-Button, hervorgehoben (Akzentfarbe,
    // siehe styles.css) - im Gegensatz zu diesem schreibt diese Variante beim
    // Umbenennen zusätzlich den TYP-Wert aller betroffenen Notizen um (nach
    // Bestätigung, siehe startDetailRename/ConfirmRenameTypeModal).
    const renameWithNotesBtn = header.createDiv({
      cls: "clickable-icon fred-typ-detail-rename-notes",
      attr: { "aria-label": "Umbenennen (inkl. Notizen anpassen)" },
    });
    setIcon(renameWithNotesBtn, "pencil");
    renameWithNotesBtn.addEventListener("click", () => this.startDetailRename(type, titleEl, { updateNotes: true }));

    const renameBtn = header.createDiv({ cls: "clickable-icon fred-typ-detail-rename", attr: { "aria-label": "Umbenennen" } });
    setIcon(renameBtn, "pencil");
    renameBtn.addEventListener("click", () => this.startDetailRename(type, titleEl));

    const deleteBtn = header.createDiv({ cls: "clickable-icon fred-typ-detail-delete", attr: { "aria-label": "Löschen" } });
    setIcon(deleteBtn, "trash");
    deleteBtn.addEventListener("click", () => this.showDeleteConfirm(type));

    const body = contentEl.createDiv({ cls: "fred-typ-detail-body" });

    // Eine Zeile unter der Kopfzeile: links "manuell erstellbar" und die
    // TYP-Farbe, rechts daneben die Beschreibung über den restlichen Platz.
    // Umbenennen und Löschen stehen oben in der Kopfzeile.
    const optionsHeader = body.createDiv({ cls: "fred-typ-frontmatter-header fred-typ-options-header" });

    this.renderManualToggle(optionsHeader, type);

    const colorRow = optionsHeader.createDiv({ cls: "fred-typ-detail-color-row" });
    this.renderColorPicker(
      colorRow,
      type,
      (newColor) => {
        if (!this.plugin.settings.colorViews.typList) return;
        // Dieselbe Custom Property wie beim Aufbau oben, nicht style.color:
        // eine Inline-Farbe wuerde die Akzentfarbe beim Hovern wieder schlagen.
        titleEl.style.setProperty("--fred-typ-name-color", newColor);
      },
      { showReset: true }
    );

    // Rechts neben den beiden Knöpfen, den übrigen Platz der Zeile füllend. Einzeiliges Input statt des früheren zweizeiligen
    // Textarea - in einer Zeile neben den Icons hat ein mehrzeiliges Feld
    // keinen Platz, und dieselbe Beschreibung ist in der TYP-Liste ohnehin
    // schon als einzeiliges Input bearbeitbar (siehe renderDescriptionInput).
    // Ohne eigene Überschrift: solange das Feld leer ist, sagt sein
    // Platzhalter (gefadet, siehe styles.css), worum es geht.
    const descInput = optionsHeader.createEl("input", {
      type: "text",
      cls: "fred-typ-description-input",
      attr: { placeholder: "Beschreibung" },
    });
    descInput.value = this.plugin.settings.typeDescriptions[type] ?? "";
    descInput.addEventListener("change", async () => {
      const value = descInput.value.trim();
      if (value) this.plugin.settings.typeDescriptions[type] = value;
      else delete this.plugin.settings.typeDescriptions[type];
      await this.plugin.saveSettings();
    });

    // Trennt die Frontmatter-Blöcke von den übrigen Einstellungen des TYPs
    // (Beschreibung, Farbe, "manuell erstellbar").
    body.createDiv({ cls: "fred-typ-detail-separator" });

    // TYP-Frontmatter und je registriertem Subtyp ein Block darunter, jeder
    // mit eigener Editor-Instanz (siehe frontmatter-blocks.js) - derselbe Key
    // darf deshalb in mehreren Blöcken stehen. Ein Subtyp-Block ergänzt das
    // TYP-Frontmatter für Notizen mit diesem SUBTYP und überschreibt dort
    // gleichnamige Properties (siehe subtypes.js).
    const bucket = this.plugin.typIndex.subtypeBucket(type);
    this.frontmatterBlocks = mountFrontmatterBlocks(this, body, type, {
      renderHeader: (section, el, blocks) => this.renderSectionHeader(el, type, section, bucket, blocks),
      renderFooter: (section, el) => {
        if (section !== null) this.renderSectionFooter(el, type, section);
      },
      onMoveSection: async (order) => {
        reorderSubtypes(this.plugin.settings, type, order);
        await this.plugin.saveSettings();
        this.render();
      },
    });
    this.frontmatterEditors.push(...this.frontmatterBlocks.editors);

    // Bewusst über die volle Breite und in Akzentfarbe, damit er sich von den
    // kleinen Icon-Buttons der Blöcke abhebt.
    this.subtypeAddBtnEl = body.createEl("button", { cls: "mod-cta fred-typ-subtype-add" });
    setIcon(this.subtypeAddBtnEl.createSpan({ cls: "fred-typ-subtype-add-icon" }), "plus");
    this.subtypeAddBtnEl.createSpan({ text: "Subtyp hinzufügen" });
    this.subtypeAddBtnEl.addEventListener("click", () => this.startAddSubtype(type));

    this.renderUnregisteredSubtypes(body, type, bucket);

    body.createDiv({ cls: "fred-typ-detail-separator" });
    this.renderFloatingHint(body);
    // Fett-Markierung (siehe frontmatter-default-highlight.js) reagiert nur auf
    // Metadaten-/Layout-Events - das Öffnen dieser Detailansicht selbst löst
    // keins davon aus, daher hier direkt nach dem Mounten anstoßen. Bewusst
    // nur dieser eine, gezielte Refresh statt des vollen refreshTypColors()-
    // Bündels: das würde u. a. auch render() auf diesem (gerade erst mitten
    // im eigenen render()-Durchlauf befindlichen) View erneut auslösen.
    this.plugin.refreshFrontmatterHighlight?.();
  }

  // Überschrift eines Blocks (siehe frontmatter-blocks.js): Titel mit
  // Notiz-Anzahl (beim TYP-Frontmatter die Notizen ohne SUBTYP - für die gilt
  // nur dieser Block), Suche per Klick auf den Titel, und die beiden
  // "Property hinzufügen"-Buttons, die eine Leerzeile in genau diesem Block
  // anlegen.
  renderSectionHeader(el, type, section, bucket, blocks) {
    const titleGroup = el.createDiv({ cls: "fred-typ-frontmatter-title-group" });
    // Bewusst nie eingefärbt (weder in der TYP- noch in der Subtyp-Farbe),
    // anders als der Titel der Detailansicht darüber: die Farbe eines Blocks
    // steht im Farbpunkt seines Abschlusses (siehe renderSectionFooter).
    const titleEl = titleGroup.createDiv({ cls: "fred-typ-detail-section-title", text: section ?? `${type}-Frontmatter` });
    const count = section === null ? bucket.noSubtype : bucket.counts.get(section) ?? 0;
    titleGroup.createSpan({ cls: "fred-typ-subtype-count", text: String(count) });
    this.makeSearchable(titleEl, () => this.openSubtypeSearch(type, section));

    // Floating Properties (siehe typeFloatingKeys in settings.js) sind Teil
    // derselben Liste und Reihenfolge wie die übrigen Properties (wichtig für
    // die Frontmatter-Sortierung), landen also an genau der Stelle, an die sie
    // per Drag & Drop einsortiert werden, statt fest ans Ende einer zweiten Liste.
    const addButtons = el.createDiv({ cls: "fred-typ-frontmatter-add-group" });

    // Links neben dem normalen Button, hervorgehoben (Akzentfarbe, wie
    // renameWithNotesBtn oben) - markiert die als nächstes hinzugefügte (bzw.
    // bis zum nächsten Speichern umbenannte) Property als Floating, statt sie
    // als normale Standard-Property anzulegen (siehe editor.fredPendingFloatingAdd
    // in type-frontmatter-editor.js). Floating Properties werden NICHT
    // automatisch bei neuen Notizen angelegt (siehe getTypeDefaults() in
    // main.js) und dort, sobald doch vorhanden, kursiv statt fett dargestellt
    // (siehe frontmatter-default-highlight.js).
    const addFloatingPropertyBtn = addButtons.createDiv({
      cls: "clickable-icon fred-typ-frontmatter-add-floating",
      attr: { "aria-label": "Floating Property hinzufügen" },
    });
    setIcon(addFloatingPropertyBtn, "plus");
    addFloatingPropertyBtn.addEventListener("click", () => blocks.addBlank(section, true));

    const addPropertyBtn = addButtons.createDiv({
      cls: "clickable-icon fred-typ-frontmatter-add",
      attr: { "aria-label": "Property hinzufügen" },
    });
    setIcon(addPropertyBtn, "plus");
    addPropertyBtn.addEventListener("click", () => blocks.addBlank(section, false));
  }

  // Abschluss eines Subtyp-Blocks: links die Farbe des Subtyps (Farbpunkt, der
  // die Regler öffnet, daneben Zurücksetzen), rechts die Aktionen wie im Kopf
  // der TYP-Detailansicht (Umbenennen inkl. Notizen, Umbenennen, Löschen). Das
  // TYP-Frontmatter hat keinen. Der Titel wird erst beim Klick gesucht -
  // Überschrift und Abschluss entstehen bei jedem synchronize() neu.
  renderSectionFooter(el, type, subtype) {
    el.addClass("fred-typ-subtype-actions");
    const colorGroup = el.createDiv({ cls: "fred-typ-subtype-color-group" });
    // Ring auch, solange der TYP selbst keine Farbe hat - dann färbt auch
    // eine eingestellte Abweichung nirgends ein.
    const ownColor = subtypeHasOwnColor(this.plugin.settings, type, subtype);
    const typeHasColor = !!this.plugin.settings.typeColors[type];
    const colorDot = colorGroup.createDiv({
      cls: "fred-typ-subtype-color-dot",
      attr: { "aria-label": !typeHasColor ? "TYP hat keine Farbe" : ownColor ? "Farbe anpassen" : "Übernimmt TYP-Farbe" },
    });
    colorDot.fredSubtype = subtype;
    paintColorDot(colorDot, subtypeColor(this.plugin.settings, type, subtype) ?? DEFAULT_TYPE_COLOR, !ownColor || !typeHasColor);
    colorDot.addEventListener("click", () => this.openSubtypeColorPopover(colorDot, type, subtype));
    const resetBtn = colorGroup.createDiv({ cls: "clickable-icon fred-typ-color-reset", attr: { "aria-label": "Farbe zurücksetzen" } });
    resetBtn.toggleClass("is-disabled", !ownColor);
    setIcon(resetBtn, "rotate-ccw");
    resetBtn.addEventListener("click", async () => {
      const data = getSubtype(this.plugin.settings, type, subtype);
      if (!data?.color) return;
      delete data.color;
      await this.plugin.saveSettings();
      this.plugin.refreshTypColors?.();
      this.render();
    });

    const actions = el.createDiv({ cls: "fred-typ-subtype-action-group" });
    const titleEl = () => {
      let sibling = el.previousElementSibling;
      while (sibling && !sibling.hasClass("fred-typ-section-header")) sibling = sibling.previousElementSibling;
      return sibling?.querySelector(".fred-typ-detail-section-title") ?? null;
    };
    const rename = (updateNotes) => {
      const target = titleEl();
      if (target) this.startSubtypeRename(type, subtype, target, { updateNotes });
    };

    const renameWithNotesBtn = actions.createDiv({
      cls: "clickable-icon fred-typ-detail-rename-notes",
      attr: { "aria-label": "Umbenennen (inkl. Notizen anpassen)" },
    });
    setIcon(renameWithNotesBtn, "pencil");
    renameWithNotesBtn.addEventListener("click", () => rename(true));

    const renameBtn = actions.createDiv({ cls: "clickable-icon fred-typ-detail-rename", attr: { "aria-label": "Umbenennen" } });
    setIcon(renameBtn, "pencil");
    renameBtn.addEventListener("click", () => rename(false));

    const deleteBtn = actions.createDiv({ cls: "clickable-icon fred-typ-detail-delete", attr: { "aria-label": "Löschen" } });
    setIcon(deleteBtn, "trash");
    deleteBtn.addEventListener("click", () => this.deleteSubtypeWithConfirm(type, subtype));
  }

  // Popover unter dem Farbpunkt eines Subtyp-Blocks: je ein Regler für
  // Farbton, Sättigung und Helligkeit, begrenzt auf die in den Einstellungen
  // festgelegte Abweichung (siehe type-colors.js). Die Leiste jedes Reglers
  // zeigt als Verlauf die Farben, die er erreichen kann. Beim Ziehen ändert
  // sich nur der Farbpunkt hier; gespeichert und in die übrigen Ansichten
  // übernommen wird beim Schließen (Klick daneben oder Escape) - ein
  // refreshTypColors() rendert u. a. diese Ansicht neu.
  openSubtypeColorPopover(anchorEl, type, subtype) {
    this.closeSubtypeColorPopover?.();
    const { settings } = this.plugin;
    const data = getSubtype(settings, type, subtype);
    if (!data) return;
    const typeColor = settings.typeColors[type] ?? DEFAULT_TYPE_COLOR;
    // Ohne eigene Abweichung steht jeder Regler auf 0 - welche es gibt, sagt
    // allein SUBTYPE_COLOR_CHANNELS (siehe type-colors.js).
    const offset = clampedOffset(settings, data.color) ?? Object.fromEntries(SUBTYPE_COLOR_CHANNELS.map(({ key }) => [key, 0]));
    const doc = anchorEl.doc;
    const popover = doc.body.createDiv({ cls: "menu fred-typ-subtype-color-popover" });

    const rows = [];
    const update = () => {
      const color = applyColorOffset(typeColor, offset);
      for (const el of this.contentEl.querySelectorAll(".fred-typ-subtype-color-dot")) {
        if (el.fredSubtype === subtype) paintColorDot(el, color, !hasColorOffset(offset) || !settings.typeColors[type]);
      }
      for (const row of rows) row();
    };

    for (const { key, label, unit } of SUBTYPE_COLOR_CHANNELS) {
      const [min, max] = channelBounds(settings, key);
      const row = popover.createDiv({ cls: "fred-typ-subtype-color-row" });
      row.createSpan({ cls: "fred-typ-subtype-color-label", text: label });
      const input = row.createEl("input", { type: "range", cls: "slider fred-typ-subtype-color-slider" });
      input.min = String(min);
      input.max = String(max);
      input.step = "1";
      input.value = String(offset[key]);
      input.disabled = min === max;
      const valueEl = row.createSpan({ cls: "fred-typ-subtype-color-value" });
      input.addEventListener("input", () => {
        offset[key] = Number(input.value);
        update();
      });
      rows.push(() => {
        const steps = 8;
        const stops = [];
        for (let i = 0; i <= steps; i++) {
          stops.push(applyColorOffset(typeColor, { ...offset, [key]: min + ((max - min) * i) / steps }));
        }
        input.style.setProperty("--fred-track", `linear-gradient(to right, ${stops.join(", ")})`);
        valueEl.setText(`${offset[key] > 0 ? "+" : ""}${offset[key]}${unit}`);
      });
    }
    update();

    // Unter dem Punkt, aber innerhalb des Fensters.
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
      this.closeSubtypeColorPopover = null;
      doc.removeEventListener("mousedown", onPointerDown, true);
      doc.removeEventListener("keydown", onKeyDown, true);
      popover.remove();
      const current = getSubtype(settings, type, subtype);
      if (!current) return;
      if (hasColorOffset(offset)) current.color = { ...offset };
      else delete current.color;
      await this.plugin.saveSettings();
      this.plugin.refreshTypColors?.();
      this.render();
    };
    this.closeSubtypeColorPopover = close;
    doc.addEventListener("mousedown", onPointerDown, true);
    doc.addEventListener("keydown", onKeyDown, true);
  }

  // Löscht den Subtyp-Block samt seiner Properties. Die Notizen behalten ihren
  // SUBTYP-Wert (er erscheint danach unten als nicht erfasster Subtyp) - eine
  // Bestätigung braucht es daher nur, wenn dabei Properties verloren gehen.
  deleteSubtypeWithConfirm(type, subtype) {
    const apply = async () => {
      deleteSubtype(this.plugin.settings, type, subtype);
      await this.plugin.saveSettings();
      this.plugin.refreshTypColors?.();
      this.render();
    };
    const keys = Object.keys(getSubtype(this.plugin.settings, type, subtype)?.frontmatter ?? {}).filter((key) => key !== "");
    if (keys.length === 0) {
      apply();
      return;
    }
    new ConfirmSubtypeModal(this.app, {
      paragraphs: [
        `Subtyp ${subtype} von ${type} wirklich löschen?`,
        `${keys.length === 1 ? "Die Property" : `Die ${keys.length} Properties`} ${keys.join(", ")} ${keys.length === 1 ? "geht" : "gehen"} dabei verloren.`,
      ],
      confirmText: "Löschen",
      confirmCls: "mod-warning",
      onConfirm: apply,
    }).open();
  }

  // Wie startDetailRename(), aber auf dem Titel eines Subtyp-Blocks. Der Block
  // behält seine Position; updateNotes: true schreibt nach Bestätigung auch den
  // SUBTYP der betroffenen Notizen um. Ein bereits vorhandener Name bietet
  // stattdessen das Zusammenlegen an (schreibt die Notizen immer mit um).
  startSubtypeRename(type, subtype, titleEl, { updateNotes = false } = {}) {
    if (this.isEditing) return;
    this.isEditing = true;

    titleEl.addClass("fred-typ-subtype-name-input", "is-being-renamed");
    titleEl.setAttribute("contenteditable", "true");
    titleEl.setAttribute("spellcheck", "false");
    titleEl.focus();

    const range = titleEl.doc.createRange();
    range.selectNodeContents(titleEl);
    const selection = titleEl.win.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    const countOf = (name) => this.plugin.typIndex.subtypeBucket(type).counts.get(name) ?? 0;
    const applyRename = async (value, { withNotes }) => {
      renameSubtype(this.plugin.settings, type, subtype, value);
      await this.plugin.saveSettings();
      const renamed = withNotes ? await renameSubtypeInNotes(this.plugin, type, subtype, value) : 0;
      this.plugin.refreshTypColors?.();
      if (withNotes) new Notice(`SUBTYP ${value}: ${renamed} Notiz(en) angepasst.`);
      this.render();
    };

    let done = false;
    const finish = async (commit) => {
      if (done) return;
      done = true;
      this.isEditing = false;

      const value = normalizeSubtypeName(titleEl.textContent);
      if (!commit || !value || value === subtype) {
        this.render();
        return;
      }

      const existing = getSubtypeNames(this.plugin.settings, type).find(
        (name) => name.toLowerCase() === value.toLowerCase() && name !== subtype
      );
      if (existing) {
        new ConfirmSubtypeModal(this.app, {
          paragraphs: [
            `Subtyp ${existing} existiert bei ${type} bereits. ${subtype} damit zusammenlegen?`,
            `${countOf(subtype)} Notiz(en) werden auf ${existing} umgestellt, die Properties von ${subtype} wandern in den Block ${existing}.`,
          ],
          confirmText: "Zusammenlegen",
          confirmCls: "mod-warning",
          onConfirm: async () => {
            mergeSubtypes(this.plugin.settings, type, subtype, existing);
            await this.plugin.saveSettings();
            const renamed = await renameSubtypeInNotes(this.plugin, type, subtype, existing);
            this.plugin.refreshTypColors?.();
            new Notice(`Subtyp ${subtype} mit ${existing} zusammengelegt, ${renamed} Notiz(en) angepasst.`);
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
      new ConfirmSubtypeModal(this.app, {
        paragraphs: [`Subtyp ${subtype} in ${value} umbenennen und ${countOf(subtype)} Notiz(en) entsprechend anpassen?`],
        confirmText: "Umbenennen",
        confirmCls: "mod-cta",
        onConfirm: () => applyRename(value, { withNotes: true }),
        onCancel: () => this.render(),
      }).open();
    };

    // Alle Tasten hier behalten: der Titel steht in der Liste von Obsidians
    // Property-Editor, dessen eigene Tastatur-Navigation sonst mitreagierte
    // (Escape zusätzlich wegen der Detailansicht, siehe onOpen).
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

  // Wie die unregistrierten Einträge der TYP-Liste: SUBTYP-Werte von Notizen
  // dieses TYPs, die (noch) keinen eigenen Block haben (Notizen ganz ohne
  // SUBTYP zählt stattdessen das TYP-Frontmatter). Dargestellt wie die
  // Subtyp-Blöcke, aber nur mit Überschrift samt Anzahl. Ein Klick auf die
  // Blockfläche übernimmt den Wert als Subtyp, ein Klick auf den Namen öffnet
  // stattdessen die Suche - vor dem Erfassen nachzusehen, was in einem Wert
  // eigentlich steckt, ist hier der häufige Fall. Der Name hebt sich beim
  // Hovern in Akzentfarbe ab und zeigt damit selbst an, dass er etwas anderes
  // tut als die Fläche um ihn herum.
  renderUnregisteredSubtypes(parent, type, bucket) {
    const registered = getSubtypeNames(this.plugin.settings, type);
    const unregistered = [...bucket.counts.keys()]
      .filter((key) => !registered.includes(key))
      .sort((a, b) => bucket.counts.get(b) - bucket.counts.get(a) || a.localeCompare(b));
    if (unregistered.length === 0) return;

    const listEl = parent.createDiv({ cls: "fred-typ-subtype-unregistered-list" });
    for (const key of unregistered) {
      const block = listEl.createDiv({ cls: "fred-typ-frontmatter-block fred-typ-subtype-block fred-typ-subtype-unregistered" });
      const header = block.createDiv({ cls: "fred-typ-frontmatter-header" });
      const titleGroup = header.createDiv({ cls: "fred-typ-frontmatter-title-group" });
      const titleEl = titleGroup.createDiv({ cls: "fred-typ-detail-section-title", text: displayTypeKey(key) });
      titleGroup.createSpan({ cls: "fred-typ-subtype-count", text: String(bucket.counts.get(key)) });
      block.addEventListener("click", () => this.registerSubtype(type, key, bucket));
      // stopPropagation, sonst erfasste derselbe Klick über den Block-Handler
      // zusätzlich den Wert, den man gerade erst nachschlagen wollte.
      this.makeSearchable(titleEl, () => this.openSubtypeSearch(type, key), { stopPropagation: true });
    }
  }

  // Ein Name, dessen Klick die Suche öffnet: Zeiger-Cursor und Akzentfarbe beim
  // Hovern (siehe .fred-typ-searchable in styles.css), damit die Ansicht selbst
  // zeigt, wo etwas passiert. Die Suche lag hier früher auf dem Rechtsklick -
  // beim TYP-Frontmatter auf dem Titel, bei Subtyp-Blöcken auf der ganzen
  // Blockfläche - und war damit praktisch unauffindbar: nichts deutete darauf
  // hin, und ein Rechtsklick ist überall sonst ein Kontextmenü. Der Name ist
  // der Ort, an dem man "zeig mir diese Notizen" erwartet, also hängt es jetzt
  // genau dort. Während einer Umbenennung trägt dasselbe Element die Klasse
  // is-being-renamed und ist ein Eingabefeld - dann darf ein Klick hinein den
  // Cursor setzen und keine Suche auslösen.
  makeSearchable(el, onSearch, { stopPropagation = false } = {}) {
    el.addClass("fred-typ-searchable");
    el.addEventListener("click", (event) => {
      if (el.hasClass("is-being-renamed")) return;
      if (stopPropagation) event.stopPropagation();
      onSearch();
    });
  }

  // subtypeKey === null → Notizen dieses TYPs ohne SUBTYP. Für eine Liste
  // gibt es wie bei openSearch() keine exakte Suchsyntax - dann nach Notizen
  // suchen, die alle ihre Einträge tragen.
  openSubtypeSearch(type, subtypeKey) {
    const globalSearch = this.plugin.app.internalPlugins.getPluginById("global-search");
    if (!globalSearch) return;
    const typClause = this.typeClause(type);
    let subtypClause;
    if (subtypeKey === null) {
      subtypClause = `-["${SUBTYP_PROPERTY}"]`;
    } else {
      const raw = this.plugin.typIndex.subtypeBucket(type).rawByKey.get(subtypeKey);
      subtypClause = Array.isArray(raw)
        ? raw.map((v) => `["${SUBTYP_PROPERTY}":"${String(v ?? "").trim()}"]`).join(" ")
        : `["${SUBTYP_PROPERTY}":"${subtypeKey}"]`;
    }
    globalSearch.instance.openGlobalSearch(`${typClause} ${subtypClause}`);
  }

  // Wie registerType(): übernimmt die bereinigte Form (Großbuchstaben, Liste
  // als Einzelwert "A, B") als Subtyp dieses TYPs und schreibt den SUBTYP der
  // betroffenen Notizen gleich mit um. Gibt es den Subtyp in anderer Schreib-
  // weise schon, landen die Notizen dort.
  async registerSubtype(type, subtypeKey, bucket) {
    const result = await this.applySubtypeRegistration(type, subtypeKey, bucket);
    if (!result) return;

    await this.plugin.saveSettings();
    this.plugin.refreshTypColors?.();
    if (result.renamed > 0) new Notice(`SUBTYP ${result.subtype} registriert, ${result.renamed} Notiz(en) angepasst.`);
  }

  // Wie applyTypeRegistration für den TYP: der Vorgang ohne Speichern und
  // Notice, damit registerTypeWithSubtype() ihn mit der TYP-Erfassung bündeln
  // kann. Liefert { subtype, renamed } oder null.
  async applySubtypeRegistration(type, subtypeKey, bucket) {
    const raw = bucket.rawByKey.get(subtypeKey);
    const normalized = normalizeRawType(raw === undefined ? subtypeKey : raw, normalizeSubtypeName);
    if (!normalized) return null;
    const existing = getSubtypeNames(this.plugin.settings, type).find((name) => name.toLowerCase() === normalized.toLowerCase());
    const subtype = existing ?? normalized;
    ensureSubtype(this.plugin.settings, type, subtype);

    const renamed = subtype !== subtypeKey ? await renameSubtypeInNotes(this.plugin, type, subtypeKey, subtype) : 0;
    return { subtype, renamed };
  }

  // Neuer, leerer Subtyp-Block direkt über dem "Subtyp hinzufügen"-Button,
  // dessen Name sofort inline eingegeben wird (wie startAdd() in der Liste).
  startAddSubtype(type) {
    if (this.isEditing || !this.subtypeAddBtnEl) return;
    this.isEditing = true;

    // Aufgebaut wie der fertige (leere) Block im gemeinsamen Editor - samt den
    // "+"-Buttons und den Aktionen im Abschluss, die hier noch nichts tun, nur
    // noch ohne Anzahl -, damit beim Abschließen der Eingabe nichts springt
    // (siehe .fred-typ-subtype-pending).
    const block = createDiv({ cls: "fred-typ-frontmatter-block fred-typ-subtype-block fred-typ-subtype-pending" });
    this.subtypeAddBtnEl.parentElement.insertBefore(block, this.subtypeAddBtnEl);
    const header = block.createDiv({ cls: "fred-typ-frontmatter-header" });
    const titleGroup = header.createDiv({ cls: "fred-typ-frontmatter-title-group" });
    const nameEl = titleGroup.createDiv({ cls: "fred-typ-detail-section-title fred-typ-subtype-name-input is-being-renamed" });
    const addButtons = header.createDiv({ cls: "fred-typ-frontmatter-add-group" });
    setIcon(addButtons.createDiv({ cls: "clickable-icon fred-typ-frontmatter-add-floating" }), "plus");
    setIcon(addButtons.createDiv({ cls: "clickable-icon fred-typ-frontmatter-add" }), "plus");
    const footer = block.createDiv({ cls: "fred-typ-section-footer fred-typ-subtype-actions" });
    const colorGroup = footer.createDiv({ cls: "fred-typ-subtype-color-group" });
    paintColorDot(colorGroup.createDiv({ cls: "fred-typ-subtype-color-dot" }), this.plugin.settings.typeColors[type] ?? DEFAULT_TYPE_COLOR, true);
    setIcon(colorGroup.createDiv({ cls: "clickable-icon fred-typ-color-reset is-disabled" }), "rotate-ccw");
    const actions = footer.createDiv({ cls: "fred-typ-subtype-action-group" });
    setIcon(actions.createDiv({ cls: "clickable-icon fred-typ-detail-rename-notes" }), "pencil");
    setIcon(actions.createDiv({ cls: "clickable-icon fred-typ-detail-rename" }), "pencil");
    setIcon(actions.createDiv({ cls: "clickable-icon fred-typ-detail-delete" }), "trash");
    nameEl.setAttribute("contenteditable", "true");
    nameEl.setAttribute("spellcheck", "false");
    nameEl.focus();

    let done = false;
    const finish = async (commit) => {
      if (done) return;
      done = true;
      this.isEditing = false;

      const value = normalizeSubtypeName(nameEl.textContent);
      if (commit && value) {
        const existing = getSubtypeNames(this.plugin.settings, type).find((name) => name.toLowerCase() === value.toLowerCase());
        if (existing) {
          new Notice(`Subtyp ${existing} gibt es bei ${type} bereits.`);
        } else {
          ensureSubtype(this.plugin.settings, type, value);
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
        // stopPropagation, sonst verlässt der Escape-Handler der gesamten
        // Detailansicht sie gleich mit.
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      }
    });
    nameEl.addEventListener("blur", () => finish(true));
  }

  showDeleteConfirm(type) {
    new ConfirmDeleteTypeModal(this.plugin, type, async () => {
      this.plugin.settings.types = this.plugin.settings.types.filter((t) => t !== type);
      delete this.plugin.settings.typeColors[type];
      delete this.plugin.settings.typeDescriptions[type];
      delete this.plugin.settings.typeDefaultFrontmatter[type];
      delete this.plugin.settings.typeFloatingKeys[type];
      delete this.plugin.settings.typeShortcuts[type];
      delete this.ensureTypeManual()[type];
      deleteTypeSubtypes(this.plugin.settings, type);
      // Vor refreshTypColors() zurück zur Liste, aus demselben Grund wie beim
      // Umbenennen: refreshTypColors() rendert (u. a. über registerTypView)
      // synchron neu - stünde selectedType noch auf dem gerade gelöschten
      // Typ, würde dessen jetzt datenlose Detailansicht kurz erneut gerendert.
      this.closeTypeSettings();
      await this.plugin.saveSettings();
      this.plugin.refreshTypColors?.();
    }).open();
  }

  // Wie startEditing(), aber auf dem freistehenden Titel-Element der Detail-Ansicht
  // statt auf einem Tree-Item - und mit resultierendem selectedType-Wechsel statt
  // eines schlichten Re-Renders der Liste. updateNotes: true (zweiter, hervor-
  // gehobener Button) schreibt nach Bestätigung zusätzlich den TYP-Wert aller
  // betroffenen Notizen um (siehe renameTypeInNotes), statt nur die Plugin-
  // Einstellungen zu migrieren.
  startDetailRename(type, titleEl, { updateNotes = false } = {}) {
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

    // Migriert nur die Plugin-Einstellungen (Liste, Farbe, Beschreibung,
    // TYP-Frontmatter, Manueller-TYP-Schalter) auf den neuen Namen -
    // rührt keine Notizen an. Gemeinsam genutzt von beiden Umbenennen-Pfaden.
    const applyRename = async (value) => {
      const idx = this.plugin.settings.types.indexOf(type);
      if (idx !== -1) this.plugin.settings.types[idx] = value;
      if (this.plugin.settings.typeColors[type] !== undefined) {
        this.plugin.settings.typeColors[value] = this.plugin.settings.typeColors[type];
        delete this.plugin.settings.typeColors[type];
      }
      if (this.plugin.settings.typeDescriptions[type] !== undefined) {
        this.plugin.settings.typeDescriptions[value] = this.plugin.settings.typeDescriptions[type];
        delete this.plugin.settings.typeDescriptions[type];
      }
      if (this.plugin.settings.typeDefaultFrontmatter[type] !== undefined) {
        this.plugin.settings.typeDefaultFrontmatter[value] = this.plugin.settings.typeDefaultFrontmatter[type];
        delete this.plugin.settings.typeDefaultFrontmatter[type];
      }
      if (this.plugin.settings.typeFloatingKeys[type] !== undefined) {
        this.plugin.settings.typeFloatingKeys[value] = this.plugin.settings.typeFloatingKeys[type];
        delete this.plugin.settings.typeFloatingKeys[type];
      }
      if (this.plugin.settings.typeShortcuts[type] !== undefined) {
        this.plugin.settings.typeShortcuts[value] = this.plugin.settings.typeShortcuts[type];
        delete this.plugin.settings.typeShortcuts[type];
      }
      if (this.ensureTypeManual()[type] !== undefined) {
        this.plugin.settings.typeManual[value] = this.plugin.settings.typeManual[type];
        delete this.plugin.settings.typeManual[type];
      }
      moveTypeSubtypes(this.plugin.settings, type, value);
      // Vor refreshTypColors() setzen: das ruft (u. a. über den in
      // registerTypView zurückgegebenen Refresh) synchron render() auf -
      // stünde selectedType noch auf dem alten (bereits migrierten,
      // daher jetzt daten-losen) Namen, würde kurzzeitig genau der Alt-
      // Name mit leeren Daten gerendert.
      this.selectedType = value;
      await this.plugin.saveSettings();
      this.plugin.refreshTypColors?.();
    };

    let done = false;
    const finish = async (commit) => {
      if (done) return;
      done = true;
      this.isEditing = false;

      const value = normalizeTypeName(titleEl.textContent);
      if (!commit || !value || value === type) {
        this.render();
        return;
      }

      const existing = this.plugin.settings.types.find(
        (t) => t.toLowerCase() === value.toLowerCase() && t !== type
      );
      if (existing) {
        this.showMergeConfirm(type, existing);
        return;
      }

      if (!updateNotes) {
        await applyRename(value);
        this.render();
        return;
      }

      // Bulk-Schreibvorgang über potenziell viele Dateien - vorher bestätigen
      // lassen, statt sofort zu speichern.
      const { counts } = this.plugin.typIndex.typeCounts();
      new ConfirmRenameTypeModal(
        this.plugin,
        type,
        value,
        counts.get(type) ?? 0,
        async () => {
          await applyRename(value);
          const renamed = await renameTypeInNotes(this.plugin, type, value);
          new Notice(`TYP ${value}: ${renamed} Notiz(en) angepasst.`);
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
        // stopPropagation, sonst greift zusätzlich der Escape-Handler der
        // gesamten Detail-Ansicht und verlässt sie gleich mit.
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      }
    });

    titleEl.addEventListener("blur", () => finish(true));
  }

  showMergeConfirm(source, target) {
    const { counts } = this.plugin.typIndex.typeCounts();
    new ConfirmMergeTypeModal(
      this.plugin,
      source,
      target,
      counts.get(source) ?? 0,
      () => this.mergeType(source, target),
      () => this.render()
    ).open();
  }

  // Legt source in target auf: Notizen werden auf target umgeschrieben,
  // source verschwindet aus der TYP-Liste samt eigener Einstellungen (target
  // behält seine). Die Subtypen von source werden übernommen, gleichnamige
  // Blöcke zusammengeführt (siehe mergeTypeSubtypes in subtypes.js).
  async mergeType(source, target) {
    const settings = this.plugin.settings;
    const renamed = await renameTypeInNotes(this.plugin, source, target);

    settings.types = settings.types.filter((t) => t !== source);
    delete settings.typeColors[source];
    delete settings.typeDescriptions[source];
    delete settings.typeDefaultFrontmatter[source];
    delete settings.typeFloatingKeys[source];
    delete settings.typeShortcuts[source];
    delete this.ensureTypeManual()[source];
    mergeTypeSubtypes(settings, source, target);

    // Vor refreshTypColors() setzen, aus demselben Grund wie in applyRename.
    this.selectedType = target;
    await this.plugin.saveSettings();
    this.plugin.refreshTypColors?.();
    new Notice(`TYP ${source} mit ${target} zusammengelegt, ${renamed} Notiz(en) angepasst.`);
    this.render();
  }

  renderCountFlair(self, count) {
    const flairOuter = self.createDiv({ cls: "tree-item-flair-outer" });
    flairOuter.createSpan({ cls: "tree-item-flair", text: String(count) });
  }

  // Rein informativ, unter dem TYP-Frontmatter-Editor: erklärt den
  // Floating-Property-Toggle (Rechtsklick auf eine Property oben, siehe
  // ensurePropertyMenuPatch in type-frontmatter-editor.js). Bewusst ohne eigene
  // Überschrift, da direkt unter der Property-Liste ohnehin klar ist, worauf
  // sich der Hinweis bezieht.
  //
  // Hier stand früher zusätzlich eine feste Liste der Platzhalter-Token. Die
  // ist mit dem Shortcut-Knopf je Property-Zeile entfallen: dessen Auswahl
  // (shortcut-picker.js) führt dieselben Token, aber am Ort der Verwendung,
  // durchsuchbar und bei Skripten samt deren eigener Beschreibung.
  renderFloatingHint(parent) {
    const section = parent.createDiv({ cls: "fred-typ-floating-hint-section" });
    section.createDiv({
      cls: "fred-typ-floating-hint",
      text: "You can change a property to floating in the right-click menu.",
    });
  }
}

function registerTypView(plugin) {
  plugin.registerView(VIEW_TYPE_TYP, (leaf) => new TypView(leaf, plugin));

  plugin.addCommand({
    id: "typ-view-oeffnen",
    name: "TYP-View öffnen",
    callback: () => activateTypView(plugin),
  });

  plugin.addCommand({
    id: "typ-property-hinzufuegen",
    name: "TYP-Property hinzufügen",
    callback: () => addTypPropertyCommand(plugin),
  });

  plugin.addCommand({
    id: "typ-hinzufuegen",
    name: "Neuen TYP hinzufügen",
    callback: () => addTypCommand(plugin),
  });

  // Beim Hot-Reload bleibt der alte Leaf als Objekt unangetastet bestehen (nur
  // unser Plugin-Modul wird neu geladen), aber "instanceof TypView" schlägt gegen
  // die neu geladene Klasse fehl. app.js selbst bestimmt getViewType() rein aus
  // leaf.view - das reicht zur Erkennung also nicht. app selbst überlebt den
  // Hot-Reload dagegen unverändert, daher die Leaf-Referenz direkt dort ablegen.
  plugin.app.workspace.onLayoutReady(() => activateTypView(plugin, false, false));

  const refresh = () => {
    for (const leaf of plugin.app.workspace.getLeavesOfType(VIEW_TYPE_TYP)) {
      leaf.view?.render?.();
    }
  };

  // Zähler (Liste und Picker, siehe typIndex.typeCounts()) sonst nur so aktuell
  // wie beim letzten Render dieser View - jede TYP-relevante Änderung anderswo
  // (neue/gelöschte Notiz, TYP oder SUBTYP umgetragen) ließe sie sonst veralten,
  // bis irgendein anderer Grund (z. B. eine Einstellung) zufällig einen Refresh
  // auslöst. Das "change"-Event des Index feuert nur bei genau solchen
  // Änderungen, nicht bei jedem Autosave-Tick. Trotzdem debounced, da das
  // Rendern der Liste vergleichsweise teuer ist - resetTimer:true sammelt eine
  // Änderungsserie (z. B. Bulk-Import) zu einem einzigen Refresh.
  const debouncedRefresh = debounce(refresh, 500, true);
  plugin.registerEvent(plugin.typIndex.on("change", debouncedRefresh));
  // Ändert die "Excluded files"-Liste selbst (z. B. Hide Folders beim Aus-/
  // Einblenden eines Ordners) - Obsidians eigener MetadataCache lauscht intern
  // ebenfalls genau auf dieses Event, um seine Ignore-Filter neu zu laden.
  plugin.registerEvent(plugin.app.vault.on("config-changed", debouncedRefresh));

  // Für plugin.refreshTypColors (z. B. nach Umschalten der "TYP-Liste
  // einfärben"-Einstellung) - rendert die Liste (bzw. bleibt in der
  // Detailansicht, render() branch't selbst) neu.
  return refresh;
}

// createIfMissing: false beim automatischen onLayoutReady-Aufruf (siehe
// registerTypView) - der soll ausschließlich einen beim Hot-Reload verwaisten,
// aber bereits vorhandenen Leaf wiederverbinden (siehe Kommentar dort), nicht
// bei jedem regulären Obsidian-Start unconditional einen neuen Leaf erzeugen
// und aktivieren. War die TYP-Pane beim letzten Beenden geschlossen (oder
// einem frischen Vault), bleibt sie ohne diese Unterscheidung sonst auch zu.
async function activateTypView(plugin, reveal = true, createIfMissing = true) {
  const app = plugin.app;
  const { workspace } = app;

  const candidates = [];
  workspace.iterateAllLeaves((leaf) => {
    if (leaf === app.__fredTypLeaf || (leaf.view && leaf.view.getViewType() === VIEW_TYPE_TYP)) {
      candidates.push(leaf);
    }
  });

  let leaf = candidates.shift() ?? null;
  for (const extra of candidates) extra.detach();

  if (!leaf) {
    if (!createIfMissing) return;
    leaf = workspace.getLeftLeaf(false);
    await leaf.setViewState({ type: VIEW_TYPE_TYP, active: true });
  } else if (!(leaf.view instanceof TypView)) {
    // active: false - reines Wiederverbinden nach Hot-Reload (siehe Kommentar
    // oben an activateTypView), der Leaf ist ja bereits vorhanden/sichtbar.
    // Mit active: true würde jeder Plugin-Reload (nicht nur ein App-Neustart)
    // den globalen Fokus auf die TYP-Pane reißen - onLayoutReady() feuert
    // seinen Callback sofort, sobald workspace.layoutReady einmal true ist,
    // also bei jedem einzelnen Hot-Reload während der Entwicklung erneut.
    await leaf.setViewState({ type: VIEW_TYPE_TYP, active: false });
  }

  app.__fredTypLeaf = leaf;
  if (reveal) workspace.revealLeaf(leaf);
}

// Vorrangig in der bereits offenen TYP-Detailansicht (dann exakt wie der
// dortige +-Button), sonst wird die Detailansicht für den TYP der aktiven
// Notiz geöffnet und die Property dort ergänzt. Ist keine Notiz offen oder
// hat sie keinen TYP, dient eine zwar nicht fokussierte, aber in der
// Detailansicht offene TYP-View als Rückfallebene. Ist nur die TYPen-Liste
// offen (kein selectedType), zählt das nicht als "offene Detailansicht" -
// dafür fehlt dort ein Frontmatter-Editor, an dem sich etwas hinzufügen ließe.
async function addTypPropertyCommand(plugin) {
  const app = plugin.app;

  const activeTypView = app.workspace.getActiveViewOfType(TypView);
  if (activeTypView && activeTypView.selectedType !== null) {
    activeTypView.frontmatterBlocks?.addBlank(null);
    return;
  }

  const file = app.workspace.getActiveFile();
  const type = plugin.typIndex.typeOf(file);
  if (!type) {
    const openLeaf = app.workspace
      .getLeavesOfType(VIEW_TYPE_TYP)
      .find((leaf) => leaf.view instanceof TypView && leaf.view.selectedType !== null);
    if (openLeaf) {
      await app.workspace.revealLeaf(openLeaf);
      openLeaf.view.frontmatterBlocks?.addBlank(null);
      return;
    }
    new Notice(file ? "Aktive Notiz hat keinen TYP und in der TYP-View ist kein TYP geöffnet." : "Keine Notiz offen und in der TYP-View ist kein TYP geöffnet.");
    return;
  }

  await activateTypView(plugin);
  const view = app.__fredTypLeaf?.view;
  if (!(view instanceof TypView)) return;
  view.openTypeSettings(type);
  view.frontmatterBlocks?.addBlank(null);
}

// Öffnet bei Bedarf erst die TYP-View (bzw. verlässt eine offene Detailansicht
// zurück zur Liste - startAdd() legt das neue Tree-Item in this.listEl an, das
// es nur in der Listenansicht gibt), und stößt dort denselben Ablauf wie der
// +-Button im Listen-Header an.
async function addTypCommand(plugin) {
  await activateTypView(plugin);
  const view = plugin.app.__fredTypLeaf?.view;
  if (!(view instanceof TypView)) return;
  if (view.selectedType !== null) view.closeTypeSettings();
  view.startAdd();
}

module.exports = { registerTypView, VIEW_TYPE_TYP, compareTypes, sortTypesByMode, DEFAULT_SORT_ORDER, DEFAULT_TYPE_COLOR };
