const { FuzzySuggestModal, Notice } = require("obsidian");
const { DEFAULT_TYPE_COLOR, scanTypes, compareTypes, DEFAULT_SORT_ORDER } = require("./typ-view");

// Nativer Ersatz für Templaters tp.system.suggester bei der TYP-Auswahl (siehe
// _obsidian/templater-scripts/TYP.js): baut auf Obsidians eigenem
// FuzzySuggestModal auf (dieselbe Basis, auf der auch Templaters Suggester
// selbst beruht), zeigt zusätzlich aber TYP-Farbe/-Punkt, Beschreibung und
// Notiz-Anzahl je Zeile. Nicht erfasste (item.unregistered) TYPen werden statt
// in ihrer (nicht existierenden) Farbe muted dargestellt, analog zur
// TYP-Liste selbst (siehe .fred-typ-unregistered in typ-view.js).
class TypPickerModal extends FuzzySuggestModal {
  constructor(app, plugin, items, resolve) {
    super(app);
    this.plugin = plugin;
    this.items = items;
    this.resolve = resolve;
    this.chosen = false;
    this.setPlaceholder("ESC für Abbruch");
  }

  getItems() {
    return this.items;
  }

  // Fuzzy-Suche greift auch auf die Beschreibung, nicht nur auf den TYP-Namen.
  getItemText(item) {
    return item.description ? `${item.type} ${item.description}` : item.type;
  }

  renderSuggestion(match, el) {
    const item = match.item;
    el.addClass("fred-typ-picker-suggestion");
    if (item.unregistered) el.addClass("fred-typ-picker-unregistered");

    if (item.unregistered) {
      el.createSpan({ cls: "fred-typ-picker-name", text: item.type });
    } else {
      const color = this.plugin.settings.typeColors[item.type] ?? DEFAULT_TYPE_COLOR;
      if (this.plugin.settings.colorViews.typList) {
        el.createSpan({ cls: "fred-typ-picker-name", text: item.type }).style.color = color;
      } else {
        el.createSpan({ cls: "fred-typ-picker-dot" }).style.backgroundColor = color;
        el.createSpan({ cls: "fred-typ-picker-name", text: item.type });
      }
    }

    if (item.description) {
      el.createSpan({ cls: "fred-typ-picker-desc", text: item.description });
    }

    el.createSpan({ cls: "fred-typ-picker-count", text: String(item.count) });
  }

  // Obsidians SuggestModal.selectSuggestion() ruft intern erst this.close()
  // auf und danach erst onChooseSuggestion()/onChooseItem() - "chosen" hier zu
  // setzen (statt in onChooseItem) ist daher nicht bloß Geschmackssache: würde
  // es erst in onChooseItem gesetzt, hätte das close()-ausgelöste onClose()
  // unten "chosen" noch als false gesehen und das Promise fälschlich schon mit
  // null aufgelöst, bevor der eigentliche onChooseItem-Aufruf überhaupt lief -
  // das zweite resolve() greift dann nicht mehr (ein Promise löst nur einmal
  // auf), das Ergebnis war unabhängig von der Auswahl immer null.
  selectSuggestion(item, evt) {
    this.chosen = true;
    super.selectSuggestion(item, evt);
  }

  onChooseItem(item) {
    this.resolve(item.type);
  }

  // ESC (oder Klick daneben) schließt das Modal ohne selectSuggestion - dann
  // statt eines hängenden Promise mit null auflösen, analog zu
  // tp.system.suggester.
  onClose() {
    super.onClose();
    if (!this.chosen) this.resolve(null);
  }
}

// Nicht in plugin.settings.types registrierte TYPen, die aber tatsächlich in
// Notizen vorkommen - analog zu den "unregistrierten" Zeilen der TYP-Liste
// (siehe unregisteredRows in typ-view.js). Keine Beschreibung/Farbe, da für
// sie nichts dergleichen gepflegt ist.
function unregisteredItems(app, plugin) {
  const registered = new Set(plugin.settings.types);
  const { counts } = scanTypes(app, { includeIgnored: plugin.settings.includeIgnoredFiles });
  const sortOrder = plugin.settings.typSortOrder ?? DEFAULT_SORT_ORDER;
  return [...counts.keys()]
    .filter((type) => !registered.has(type))
    .sort((a, b) => compareTypes(sortOrder, a, b, counts, plugin.settings.typeColors))
    .map((type) => ({ type, description: "", count: counts.get(type) ?? 0, unregistered: true }));
}

// Für _obsidian/templater-scripts/TYP.js sowie überall sonst im Plugin, wo
// ein einzelner TYP ausgewählt werden muss. includeManualOff wie bei
// plugin.getTypes(): TYPen mit deaktiviertem "Manueller TYP"-Schalter sind
// standardmäßig ausgeklammert. includeUnregistered ergänzt zusätzlich TYPen,
// die in Notizen vorkommen, aber nicht in der TYP-Liste registriert sind -
// muted dargestellt, da für sie keine Farbe/Beschreibung existiert. Löst mit
// dem gewählten TYP auf, oder mit null bei Abbruch bzw. falls es (auch mit
// den gewählten Optionen) keine anzuzeigenden TYPen gibt.
function pickType(app, plugin, { includeManualOff = false, includeUnregistered = false } = {}) {
  return new Promise((resolve) => {
    const items = plugin.getTypes({ includeManualOff }).map((item) => ({ ...item, unregistered: false }));
    if (includeUnregistered) items.push(...unregisteredItems(app, plugin));

    if (items.length === 0) {
      new Notice("Keine TYPen vorhanden.");
      resolve(null);
      return;
    }

    new TypPickerModal(app, plugin, items, resolve).open();
  });
}

module.exports = { pickType };
