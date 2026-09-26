const { ItemView, Menu, Modal, Notice, setIcon, debounce } = require("obsidian");
const { mountFrontmatterEditor, addBlankProperty, typeStore, subtypeStore } = require("./type-frontmatter-editor");
const {
  getSubtypeNames,
  getSubtype,
  ensureSubtype,
  moveTypeSubtypes,
  deleteTypeSubtypes,
  mergeTypeSubtypes,
  renameSubtypeInNotes,
} = require("./subtypes");
const { FRONTMATTER_PLACEHOLDERS, DYNAMIC_PLACEHOLDER_INFO } = require("./frontmatter-placeholders");
const { normalizeTypeName, compareTypes, sortTypesByMode } = require("./type-utils");
const { typeKeyOf, TYP_PROPERTY, SUBTYP_PROPERTY } = require("./typ-index");

const VIEW_TYPE_TYP = "fred-typ-view";
const DEFAULT_TYPE_COLOR = "#888888";
const DEFAULT_SORT_ORDER = "count-desc";

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
// wird dabei also als Ganzes ersetzt statt nur einer ihrer Einträge.
async function renameTypeInNotes(plugin, oldKey, newValue) {
  let changed = 0;
  for (const file of plugin.typIndex.filesWithType(oldKey)) {
    let matched = false;
    await plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
      if (typeKeyOf(frontmatter[TYP_PROPERTY]) !== oldKey) return;
      frontmatter[TYP_PROPERTY] = newValue;
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
// (siehe startDetailRename/showMergeConfirm).
function normalizeRawType(raw) {
  if (Array.isArray(raw)) {
    return raw
      .map((v) => normalizeTypeName(String(v ?? "")))
      .filter(Boolean)
      .join(", ");
  }
  return normalizeTypeName(String(raw));
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
// dem Umbenennen erhalten bleibt) Farbe verwendet werden kann.
function appendTypeName(parentEl, plugin, type, color) {
  if (plugin.settings.colorViews.typList) {
    parentEl.createSpan({ cls: "fred-typ-inline-name", text: type }).style.color = color;
  } else {
    parentEl.createSpan({ cls: "fred-typ-inline-dot" }).style.backgroundColor = color;
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
    appendTypeName(p, this.plugin, this.type, this.plugin.settings.typeColors[this.type] ?? DEFAULT_TYPE_COLOR);
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
    const color = this.plugin.settings.typeColors[this.oldType] ?? DEFAULT_TYPE_COLOR;
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
    appendTypeName(p, this.plugin, this.newType, settings.typeColors[this.newType] ?? DEFAULT_TYPE_COLOR);
    p.appendText(" existiert bereits. ");
    appendTypeName(p, this.plugin, this.oldType, settings.typeColors[this.oldType] ?? DEFAULT_TYPE_COLOR);
    p.appendText(" damit zusammenlegen?");

    contentEl.createEl("p", {
      text:
        `${this.affectedCount} Notiz(en) werden auf ${this.newType} umgestellt. ` +
        `Farbe, Beschreibung und Standard-Frontmatter von ${this.oldType} entfallen, ` +
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
    this.frontmatterEditor = null;
    this.frontmatterEditors = [];

    this.contentEl.empty();
    this.contentEl.addClass("fred-typ-view");

    this.registerDomEvent(this.contentEl, "keydown", (event) => {
      if (event.key === "Escape" && this.selectedType !== null) this.closeTypeSettings();
    });
    this.render();
  }

  async onClose() {}

  openSearch(type) {
    const globalSearch = this.plugin.app.internalPlugins.getPluginById("global-search");
    if (!globalSearch) return;
    // "kein Typ" träfe ohne Filter auch alle Nicht-Markdown-Dateien (die naturgemäß
    // nie eine Frontmatter-Property haben können) - daher explizit auf .md eingrenzen.
    // Für eine Liste (unregistrierter Schlüssel "[A, B]") gibt es keine exakte
    // Suchsyntax - dann nach Notizen suchen, die alle ihre Einträge tragen.
    const raw = type === null ? undefined : this.plugin.typIndex.rawValueOf(type);
    const query =
      type === null
        ? `-["${TYP_PROPERTY}"] file:.md`
        : Array.isArray(raw)
          ? raw.map((v) => `["${TYP_PROPERTY}":"${String(v ?? "").trim()}"]`).join(" ")
          : `["${TYP_PROPERTY}":"${type}"]`;
    globalSearch.instance.openGlobalSearch(query);
  }

  // typeKey kommt 1:1 aus den tatsächlichen Frontmatter-Werten (siehe
  // unregisteredRows in render() und typeKeyOf in typ-index.js) - kann also
  // klein geschrieben sein, Randleerzeichen tragen oder eine Liste sein. TYPen
  // werden aber immer als sauberer Einzelwert in Großbuchstaben geführt -
  // registriert wird deshalb die bereinigte Form (siehe normalizeRawType), und
  // die betroffenen Notizen werden gleich mit umgeschrieben, damit sie nicht
  // weiterhin als "nicht registriert" auftauchen.
  async registerType(typeKey) {
    const raw = this.plugin.typIndex.rawValueOf(typeKey);
    const normalized = normalizeRawType(raw === undefined ? typeKey : raw);
    if (!normalized) return;
    if (!this.plugin.settings.types.includes(normalized)) {
      this.plugin.settings.types.push(normalized);
    }

    let renamed = 0;
    if (normalized !== typeKey) {
      renamed = await renameTypeInNotes(this.plugin, typeKey, normalized);
    }

    await this.plugin.saveSettings();
    this.render();
    this.plugin.refreshTypColors?.();

    if (renamed > 0) {
      new Notice(`TYP ${normalized} registriert, ${renamed} Notiz(en) angepasst.`);
    }
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
  // frontmatterEditor ist der Editor des TYP-Blocks (u. a. für den Befehl
  // "Standard-Property hinzufügen"), frontmatterEditors alle Editoren der
  // Detailansicht inkl. der Subtyp-Blöcke.
  destroyFrontmatterEditor() {
    for (const editor of this.frontmatterEditors ?? []) this.removeChild(editor);
    this.frontmatterEditors = [];
    this.frontmatterEditor = null;
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

      // "[KEIN TYP]" ist kein echter Typ und nimmt an der Sortierung nicht teil -
      // steht unabhängig von seiner Anzahl immer zuletzt.
      const unregisteredRows = [...counts.keys()]
        .filter((type) => !registered.includes(type))
        .sort(byCurrentOrder)
        .map((type) => ({ type, count: counts.get(type) ?? 0 }));
      if (noType > 0) {
        unregisteredRows.push({ type: null, count: noType });
      }

      const listCls = "fred-typ-list nav-files-container" + (this.plugin.settings.typListDescriptionEnabled ? "" : " fred-typ-list-no-description");
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

      if (unregisteredRows.length > 0) {
        this.separatorEl = this.listEl.createDiv({ cls: "fred-typ-separator" });
        for (const row of unregisteredRows) {
          if (row.type === null) this.renderNoTypeItem(row.count);
          else this.renderUnregisteredItem(row.type, row.count);
        }
      }
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
  // über dem frei skalierbaren Punkt platzieren.
  renderColorPicker(parent, type, onChange, { showReset = false } = {}) {
    const currentColor = this.plugin.settings.typeColors[type] ?? DEFAULT_TYPE_COLOR;
    const colorWrap = parent.createDiv({ cls: "fred-typ-color-wrap" });
    const colorDot = colorWrap.createDiv({ cls: "fred-typ-color-dot" });
    colorDot.style.backgroundColor = currentColor;

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
      colorDot.style.backgroundColor = colorInput.value;
      this.plugin.settings.typeColors[type] = colorInput.value;
      await this.plugin.saveSettings();
      onChange?.(colorInput.value);
    });

    // Erst wenn die Auswahl bestätigt und der native Picker dadurch geschlossen
    // wird, die übrigen Views nachziehen - an dem Punkt kann ein Neu-Rendern
    // dieser TYP-View selbst nichts mehr kaputt machen.
    colorInput.addEventListener("change", () => this.plugin.refreshTypColors?.());

    if (showReset) {
      const resetBtn = parent.createDiv({
        cls: "clickable-icon fred-typ-color-reset",
        attr: { "aria-label": "Farbe zurücksetzen" },
      });
      setIcon(resetBtn, "rotate-ccw");
      resetBtn.addEventListener("click", async () => {
        delete this.plugin.settings.typeColors[type];
        colorInput.value = DEFAULT_TYPE_COLOR;
        colorDot.style.backgroundColor = DEFAULT_TYPE_COLOR;
        await this.plugin.saveSettings();
        this.plugin.refreshTypColors?.();
        onChange?.(DEFAULT_TYPE_COLOR);
      });
    }

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

  // Nachgebaut wie Obsidians eigener ToggleComponent (checkbox-container +
  // verstecktes input[type=checkbox]), da wir hier direkt im DOM statt über
  // die Setting-API bauen. Standardmäßig an - daher wird (wie bei den anderen
  // typeXxx-Dicts) nur die Abweichung vom Default gespeichert, hier also nur
  // "aus" (false); fehlender Eintrag bzw. true bedeuten "an". Steuert, ob ein
  // TYP in getTypes() (siehe main.js) exportiert wird, siehe dortiger Kommentar.
  renderManualToggle(parent, type) {
    const current = this.ensureTypeManual()[type] !== false;
    const toggleEl = parent.createDiv({
      cls: "checkbox-container" + (current ? " is-enabled" : ""),
      attr: { tabindex: "0", role: "checkbox", "aria-checked": String(current) },
    });
    toggleEl.createEl("input", { type: "checkbox" });

    const toggle = async () => {
      const next = !toggleEl.hasClass("is-enabled");
      toggleEl.toggleClass("is-enabled", next);
      toggleEl.setAttribute("aria-checked", String(next));
      if (next) delete this.ensureTypeManual()[type];
      else this.ensureTypeManual()[type] = false;
      await this.plugin.saveSettings();
    };

    toggleEl.addEventListener("click", toggle);
    toggleEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggle();
      }
    });

    return toggleEl;
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

    // Echtes Text-Input statt nur Anzeige: direkt in der Liste bearbeitbar, ohne
    // dafür erst die Detailansicht öffnen zu müssen. click hier muss die Zeile
    // selbst gezielt NICHT auslösen (self.addEventListener("click", ...) unten
    // öffnet sonst die Detailansicht), daher stopPropagation. Über die Einstellung
    // "Beschreibungs-Textfeld anzeigen" komplett ausstellbar.
    if (this.plugin.settings.typListDescriptionEnabled) {
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

  renderTypeSettings(type) {
    const { contentEl } = this;
    contentEl.empty();

    const header = contentEl.createDiv({ cls: "fred-typ-detail-header" });
    const backBtn = header.createDiv({ cls: "clickable-icon fred-typ-back", attr: { "aria-label": "Zurück" } });
    setIcon(backBtn, "arrow-left");
    backBtn.addEventListener("click", () => this.closeTypeSettings());

    const titleEl = header.createDiv({ cls: "fred-typ-detail-title", text: type });
    const titleColor = this.plugin.settings.colorViews.typList ? this.plugin.settings.typeColors[type] : null;
    if (titleColor) titleEl.style.color = titleColor;

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

    const descSection = body.createDiv({ cls: "fred-typ-description-section" });

    const optionsHeader = descSection.createDiv({ cls: "fred-typ-frontmatter-header fred-typ-options-header" });
    const manualToggleWrap = optionsHeader.createDiv({ cls: "fred-typ-manual-toggle" });
    manualToggleWrap.createSpan({ cls: "fred-typ-detail-section-title", text: "Manueller TYP" });
    this.renderManualToggle(manualToggleWrap, type);

    const colorRow = optionsHeader.createDiv({ cls: "fred-typ-detail-color-row" });
    this.renderColorPicker(
      colorRow,
      type,
      (newColor) => {
        if (this.plugin.settings.colorViews.typList) titleEl.style.color = newColor;
      },
      { showReset: true }
    );

    const descHeader = descSection.createDiv({ cls: "fred-typ-frontmatter-header" });
    descHeader.createDiv({ cls: "fred-typ-detail-section-title", text: "Beschreibung" });

    const descInput = descSection.createEl("textarea", {
      cls: "fred-typ-description-input",
      attr: { rows: "2" },
    });
    descInput.value = this.plugin.settings.typeDescriptions[type] ?? "";
    descInput.addEventListener("change", async () => {
      const value = descInput.value.trim();
      if (value) this.plugin.settings.typeDescriptions[type] = value;
      else delete this.plugin.settings.typeDescriptions[type];
      await this.plugin.saveSettings();
    });

    // Trennt die Frontmatter-Blöcke von den übrigen Einstellungen des TYPs.
    body.createDiv({ cls: "fred-typ-detail-separator" });

    // Die Anzahl am Standard-Frontmatter zählt die Notizen dieses TYPs ohne
    // SUBTYP - für die gilt nur dieser Block. Rechtsklick sucht genau diese.
    const bucket = this.plugin.typIndex.subtypeBucket(type);
    this.frontmatterEditor = this.renderFrontmatterBlock(body, typeStore(this.plugin, type), "Standard-Frontmatter", {
      count: bucket.noSubtype,
      onContextMenu: () => this.openSubtypeSearch(type, null),
    });

    // Je registriertem Subtyp ein eigener Block darunter - ergänzt bzw.
    // überschreibt das Standard-Frontmatter für Notizen mit diesem SUBTYP
    // (siehe subtypes.js). Überschriebene Zeilen im TYP-Block werden
    // ausgegraut, siehe markOverriddenProperties().
    for (const subtype of getSubtypeNames(this.plugin.settings, type)) {
      this.renderFrontmatterBlock(body, subtypeStore(this.plugin, type, subtype), subtype, {
        count: bucket.counts.get(subtype) ?? 0,
        onContextMenu: () => this.openSubtypeSearch(type, subtype),
      });
    }
    this.markOverriddenProperties();

    // Bewusst über die volle Breite und in Akzentfarbe, damit er sich von den
    // kleinen Icon-Buttons der Blöcke abhebt.
    this.subtypeAddBtnEl = body.createEl("button", { cls: "mod-cta fred-typ-subtype-add" });
    setIcon(this.subtypeAddBtnEl.createSpan({ cls: "fred-typ-subtype-add-icon" }), "plus");
    this.subtypeAddBtnEl.createSpan({ text: "Subtyp hinzufügen" });
    this.subtypeAddBtnEl.addEventListener("click", () => this.startAddSubtype(type));

    this.renderUnregisteredSubtypes(body, type, bucket);

    body.createDiv({ cls: "fred-typ-detail-separator" });
    this.renderPlaceholderList(body);
    // Fett-Markierung (siehe frontmatter-default-highlight.js) reagiert nur auf
    // Metadaten-/Layout-Events - das Öffnen dieser Detailansicht selbst löst
    // keins davon aus, daher hier direkt nach dem Mounten anstoßen. Bewusst
    // nur dieser eine, gezielte Refresh statt des vollen refreshTypColors()-
    // Bündels: das würde u. a. auch render() auf diesem (gerade erst mitten
    // im eigenen render()-Durchlauf befindlichen) View erneut auslösen.
    this.plugin.refreshFrontmatterHighlight?.();
  }

  // Ein Frontmatter-Block der Detailansicht (TYP selbst oder ein Subtyp): Kopf
  // mit Titel und den beiden "Property hinzufügen"-Buttons, darunter Obsidians
  // Property-Editor, gebunden an store (siehe type-frontmatter-editor.js).
  // count/onContextMenu: Notiz-Anzahl neben dem Titel, Suche per Rechtsklick
  // auf den Titel.
  renderFrontmatterBlock(parent, store, title, { count, onContextMenu } = {}) {
    const block = parent.createDiv({ cls: "fred-typ-frontmatter-block" + (store.subtype ? " fred-typ-subtype-block" : "") });
    const sectionHeader = block.createDiv({ cls: "fred-typ-frontmatter-header" });
    const titleGroup = sectionHeader.createDiv({ cls: "fred-typ-frontmatter-title-group" });
    const titleEl = titleGroup.createDiv({ cls: "fred-typ-detail-section-title", text: title });
    if (count !== undefined) titleGroup.createSpan({ cls: "fred-typ-subtype-count", text: String(count) });
    if (onContextMenu) {
      titleEl.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        onContextMenu();
      });
    }

    // Beide Buttons hängen an derselben Editor-Instanz - Floating Properties
    // (siehe typeFloatingKeys in settings.js) sind Teil derselben Liste und
    // Reihenfolge wie die übrigen Properties des Blocks (wichtig für die
    // Frontmatter-Sortierung), landen also an genau der Stelle, an die sie per
    // Drag & Drop einsortiert werden, statt fest ans Ende einer zweiten Liste.
    const addButtons = sectionHeader.createDiv({ cls: "fred-typ-frontmatter-add-group" });
    let editor = null;

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
    addFloatingPropertyBtn.addEventListener("click", () => {
      if (editor) editor.fredPendingFloatingAdd = true;
      addBlankProperty(editor);
    });

    const addPropertyBtn = addButtons.createDiv({
      cls: "clickable-icon fred-typ-frontmatter-add",
      attr: { "aria-label": "Property hinzufügen" },
    });
    setIcon(addPropertyBtn, "plus");
    addPropertyBtn.addEventListener("click", () => {
      if (editor) editor.fredPendingFloatingAdd = false;
      addBlankProperty(editor);
    });

    editor = mountFrontmatterEditor(this, block, store);
    if (editor) this.frontmatterEditors.push(editor);
    return editor;
  }

  // Graut im TYP-Block jede Property samt Wert aus, die mindestens ein Subtyp
  // mit eigenem Wert überschreibt - der Tooltip nennt die Subtypen. Läuft nach
  // dem Rendern und bei jedem Refresh der Fett-Markierung mit (siehe
  // frontmatter-default-highlight.js), da Obsidians Editor seine Zeilen bei
  // Änderungen selbst neu aufbaut.
  markOverriddenProperties() {
    const type = this.selectedType;
    const containerEl = this.frontmatterEditor?.containerEl;
    if (type === null || !containerEl) return;

    const overriddenBy = new Map();
    for (const subtype of getSubtypeNames(this.plugin.settings, type)) {
      for (const key of Object.keys(getSubtype(this.plugin.settings, type, subtype)?.frontmatter ?? {})) {
        if (key === "") continue;
        const lower = key.toLowerCase();
        if (!overriddenBy.has(lower)) overriddenBy.set(lower, []);
        overriddenBy.get(lower).push(subtype);
      }
    }

    for (const row of containerEl.querySelectorAll(".metadata-property[data-property-key]")) {
      const subtypes = overriddenBy.get(row.getAttribute("data-property-key").toLowerCase());
      row.toggleClass("fred-typ-overridden-property", !!subtypes);
      if (subtypes) row.setAttribute("aria-label", `Überschrieben von: ${subtypes.join(", ")}`);
      else row.removeAttribute("aria-label");
    }
  }

  // Wie die unregistrierten Einträge der TYP-Liste: SUBTYP-Werte von Notizen
  // dieses TYPs, die (noch) keinen eigenen Block haben (Notizen ganz ohne
  // SUBTYP zählt stattdessen das Standard-Frontmatter). Linksklick übernimmt einen Wert als Subtyp, Rechtsklick öffnet die Suche.
  renderUnregisteredSubtypes(parent, type, bucket) {
    const registered = getSubtypeNames(this.plugin.settings, type);
    const unregistered = [...bucket.counts.keys()]
      .filter((key) => !registered.includes(key))
      .sort((a, b) => bucket.counts.get(b) - bucket.counts.get(a) || a.localeCompare(b));
    if (unregistered.length === 0) return;

    const listEl = parent.createDiv({ cls: "fred-typ-list fred-typ-subtype-unregistered-list" });
    for (const key of unregistered) {
      const self = listEl.createDiv({ cls: "tree-item" }).createDiv({ cls: "tree-item-self is-clickable fred-typ-unregistered" });
      self.createDiv({ cls: "tree-item-inner", text: displayTypeKey(key) });
      this.renderCountFlair(self, bucket.counts.get(key));
      self.addEventListener("click", () => this.registerSubtype(type, key, bucket));
      self.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.openSubtypeSearch(type, key);
      });
    }
  }

  // subtypeKey === null → Notizen dieses TYPs ohne SUBTYP. Für eine Liste
  // gibt es wie bei openSearch() keine exakte Suchsyntax - dann nach Notizen
  // suchen, die alle ihre Einträge tragen.
  openSubtypeSearch(type, subtypeKey) {
    const globalSearch = this.plugin.app.internalPlugins.getPluginById("global-search");
    if (!globalSearch) return;
    const typClause = `["${TYP_PROPERTY}":"${type}"]`;
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
    const raw = bucket.rawByKey.get(subtypeKey);
    const normalized = normalizeRawType(raw === undefined ? subtypeKey : raw);
    if (!normalized) return;
    const existing = getSubtypeNames(this.plugin.settings, type).find((name) => name.toLowerCase() === normalized.toLowerCase());
    const subtype = existing ?? normalized;
    ensureSubtype(this.plugin.settings, type, subtype);

    let renamed = 0;
    if (subtype !== subtypeKey) renamed = await renameSubtypeInNotes(this.plugin, type, subtypeKey, subtype);

    await this.plugin.saveSettings();
    this.plugin.refreshTypColors?.();
    if (renamed > 0) new Notice(`SUBTYP ${subtype} registriert, ${renamed} Notiz(en) angepasst.`);
  }

  // Neuer, leerer Subtyp-Block direkt über dem "Subtyp hinzufügen"-Button,
  // dessen Name sofort inline eingegeben wird (wie startAdd() in der Liste).
  startAddSubtype(type) {
    if (this.isEditing || !this.subtypeAddBtnEl) return;
    this.isEditing = true;

    const block = createDiv({ cls: "fred-typ-frontmatter-block fred-typ-subtype-block" });
    this.subtypeAddBtnEl.parentElement.insertBefore(block, this.subtypeAddBtnEl);
    const header = block.createDiv({ cls: "fred-typ-frontmatter-header" });
    const nameEl = header.createDiv({ cls: "fred-typ-detail-section-title fred-typ-subtype-name-input is-being-renamed" });
    nameEl.setAttribute("contenteditable", "true");
    nameEl.setAttribute("spellcheck", "false");
    nameEl.focus();

    let done = false;
    const finish = async (commit) => {
      if (done) return;
      done = true;
      this.isEditing = false;

      const value = normalizeTypeName(nameEl.textContent);
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
    // Standard-Frontmatter, Manueller-TYP-Schalter) auf den neuen Namen -
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

  // Rein informativ, unter dem Standard-Frontmatter-Editor: der Hinweistext
  // erklärt den Floating-Property-Toggle (Rechtsklick auf eine Property oben,
  // siehe ensurePropertyMenuPatch in type-frontmatter-editor.js), die Liste
  // darunter die Platzhalter, die als Wert einer Property eingetragen werden
  // können (z. B. bei "Datum" der Text "{{today}}") - getTypeDefaults()
  // (main.js) löst sie bei jedem Abruf frisch auf, siehe
  // frontmatter-placeholders.js. Bewusst ohne eigene Überschrift, da direkt
  // unter der Property-Liste ohnehin klar ist, worauf sich beides bezieht.
  renderPlaceholderList(parent) {
    const section = parent.createDiv({ cls: "fred-typ-placeholder-section" });
    const list = section.createDiv({ cls: "fred-typ-placeholder-list" });
    for (const { token, description } of [...FRONTMATTER_PLACEHOLDERS, DYNAMIC_PLACEHOLDER_INFO]) {
      const row = list.createDiv({ cls: "fred-typ-placeholder-row" });
      row.createEl("code", { cls: "fred-typ-placeholder-token", text: token });
      row.createSpan({ cls: "fred-typ-placeholder-desc", text: description });
    }
    section.createDiv({
      cls: "fred-typ-placeholder-hint",
      text: "You can change a property to floating in the right-click menu.",
    });
  }
}

function registerTypView(plugin) {
  plugin.registerView(VIEW_TYPE_TYP, (leaf) => new TypView(leaf, plugin));

  plugin.addCommand({
    id: "typ-view-oeffnen",
    name: "TYP - TYP-View öffnen",
    callback: () => activateTypView(plugin),
  });

  plugin.addCommand({
    id: "typ-property-hinzufuegen",
    name: "TYP - Standard-Property hinzufügen",
    callback: () => addTypPropertyCommand(plugin),
  });

  plugin.addCommand({
    id: "typ-hinzufuegen",
    name: "TYP - Neuen TYP hinzufügen",
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
// Notiz geöffnet und die Property dort ergänzt. Ist nur die TYPen-Liste
// offen (kein selectedType), zählt das nicht als "aktive Detailansicht" -
// dafür fehlt dort ein Frontmatter-Editor, an dem sich etwas hinzufügen ließe.
async function addTypPropertyCommand(plugin) {
  const app = plugin.app;

  const activeTypView = app.workspace.getActiveViewOfType(TypView);
  if (activeTypView && activeTypView.selectedType !== null) {
    addBlankProperty(activeTypView.frontmatterEditor);
    return;
  }

  const file = app.workspace.getActiveFile();
  const type = plugin.typIndex.typeOf(file);
  if (!type) {
    new Notice("Aktive Notiz hat keinen TYP.");
    return;
  }

  await activateTypView(plugin);
  const view = app.__fredTypLeaf?.view;
  if (!(view instanceof TypView)) return;
  view.openTypeSettings(type);
  addBlankProperty(view.frontmatterEditor);
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
