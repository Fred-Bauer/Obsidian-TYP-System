const { FuzzySuggestModal, Notice, prepareFuzzySearch } = require("obsidian");
const { DEFAULT_TYPE_COLOR, compareTypes, DEFAULT_SORT_ORDER } = require("./typ-view");
const { subtypeColor, subtypeHasOwnColor, paintColorDot } = require("./type-colors");

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
      this.renderColoredName(el, item.type, item.type);
    }

    if (item.description) {
      el.createSpan({ cls: "fred-typ-picker-desc", text: item.description });
    }

    el.createSpan({ cls: "fred-typ-picker-count", text: String(item.count) });
  }

  // Name in der Farbe von colorType - je nach Einstellung "TYP View einfärben"
  // als eingefärbter Text oder mit vorangestelltem Farbpunkt. Mit subtype
  // (und dem Unter-Schalter "Subtyp" von "TYP View") in dessen Farbe. Der
  // Punkt steht beim Standardwert als hohler Ring da (siehe paintColorDot):
  // TYP ohne Farbe grau, Subtyp ohne eigene Einstellung in der TYP-Farbe.
  renderColoredName(el, text, colorType, subtype = null) {
    const { settings } = this.plugin;
    const useSubtype = !!subtype && settings.colorViews.typListSubtyp;
    const typeColor = settings.typeColors[colorType] ?? null;
    const color = (useSubtype ? subtypeColor(settings, colorType, subtype) : typeColor) ?? DEFAULT_TYPE_COLOR;
    const isDefault = !typeColor || (useSubtype && !subtypeHasOwnColor(settings, colorType, subtype));
    if (this.plugin.settings.colorViews.typList) {
      el.createSpan({ cls: "fred-typ-picker-name", text }).style.color = color;
    } else {
      paintColorDot(el.createSpan({ cls: "fred-typ-picker-dot" }), color, isDefault);
      el.createSpan({ cls: "fred-typ-picker-name", text });
    }
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

// Auswahl eines Subtyps für einen bereits gewählten TYP (siehe pickSubtype).
// Wie TypPickerModal, zusätzlich mit einem ausgegrauten Eintrag "Kein
// Subtyp" am Ende (item.none). ESC löst mit null auf - TYP.js kehrt dann zur
// TYP-Auswahl zurück. Subtypen haben keine Beschreibung, der Name steht in
// der Farbe des Subtyps (bzw. des TYPs) mit Notiz-Anzahl.
class SubtypPickerModal extends TypPickerModal {
  constructor(app, plugin, type, items, resolve) {
    super(app, plugin, items, resolve);
    this.type = type;
    this.setPlaceholder(`Subtyp für ${type} – ESC für zurück`);
  }

  renderSuggestion(match, el) {
    const item = match.item;
    el.addClass("fred-typ-picker-suggestion");
    if (item.none) {
      el.addClass("fred-typ-picker-unregistered");
      el.createSpan({ cls: "fred-typ-picker-name", text: item.type });
    } else {
      this.renderColoredName(el, item.type, this.type, item.type);
    }
    el.createSpan({ cls: "fred-typ-picker-count", text: String(item.count) });
  }

  onChooseItem(item) {
    this.resolve(item.none ? "" : item.type);
  }
}

// TYP-Picker mit den Subtypen direkt eingerückt unter ihrem TYP (Standard,
// solange "Subtyp-Picker separat" in den Einstellungen aus ist, siehe
// pickTypeAndSubtype). Die TYP-Zeile selbst steht für "TYP ohne Subtyp".
// Gesucht wird gruppenweise statt je Zeile, damit ein Subtyp nie ohne seinen
// TYP darüber erscheint: passt die Suche auf den TYP, bleiben alle seine
// Subtypen stehen; passt sie nur auf einzelne Subtypen, bleiben diese samt
// ihrem TYP stehen. Die Gruppen sortieren sich nach ihrem besten Treffer,
// innerhalb einer Gruppe bleibt die Block-Reihenfolge.
class TypSubtypPickerModal extends TypPickerModal {
  constructor(app, plugin, groups, resolve) {
    super(app, plugin, groups.map((group) => group.item), resolve);
    this.groups = groups;
  }

  getSuggestions(query) {
    const search = query.trim() ? prepareFuzzySearch(query.trim()) : null;
    const noMatch = { score: 0, matches: [] };
    const results = [];
    for (const { item, subtypes } of this.groups) {
      const typeMatch = search ? search(this.getItemText(item)) : noMatch;
      let subtypeMatches = subtypes.map((subtype) => ({ item: subtype, match: search ? search(subtype.subtype) : noMatch }));
      if (!typeMatch) subtypeMatches = subtypeMatches.filter((entry) => entry.match);
      if (!typeMatch && subtypeMatches.length === 0) continue;

      const scores = [typeMatch, ...subtypeMatches.map((entry) => entry.match)].filter(Boolean).map((match) => match.score);
      results.push({
        score: Math.max(...scores),
        rows: [{ item, match: typeMatch ?? noMatch }, ...subtypeMatches.map((entry) => ({ item: entry.item, match: entry.match ?? noMatch }))],
      });
    }
    if (search) results.sort((a, b) => b.score - a.score);
    return results.flatMap((group) => group.rows);
  }

  renderSuggestion(match, el) {
    const item = match.item;
    if (!item.subtype) {
      super.renderSuggestion(match, el);
      return;
    }
    el.addClass("fred-typ-picker-suggestion", "fred-typ-picker-subtype");
    this.renderColoredName(el, item.subtype, item.type, item.subtype);
    el.createSpan({ cls: "fred-typ-picker-count", text: String(item.count) });
  }

  onChooseItem(item) {
    this.resolve({ type: item.type, subtype: item.subtype ?? null });
  }
}

// Für _obsidian/templater-scripts/TYP.js: öffnet den Subtyp-Picker, sobald
// der TYP mindestens einen registrierten Subtyp hat (in der Reihenfolge der
// Blöcke in der TYP-Detailansicht). Löst auf mit
//  - dem gewählten Subtyp,
//  - "" für "Kein Subtyp" - bzw. sofort, ohne Picker, wenn der TYP gar keine
//    Subtypen hat,
//  - null bei ESC (TYP.js kehrt dann zur TYP-Auswahl zurück).
function pickSubtype(app, plugin, type) {
  return new Promise((resolve) => {
    const items = plugin.getSubtypes(type).map(({ subtype, count }) => ({ type: subtype, description: "", count }));
    if (items.length === 0) {
      resolve("");
      return;
    }
    const noneCount = plugin.typIndex.subtypeBucket(type).noSubtype;
    items.push({ type: "Kein Subtyp", description: "", count: noneCount, none: true });
    new SubtypPickerModal(app, plugin, type, items, resolve).open();
  });
}

// Nicht in plugin.settings.types registrierte TYPen, die aber tatsächlich in
// Notizen vorkommen - analog zu den "unregistrierten" Zeilen der TYP-Liste
// (siehe unregisteredRows in typ-view.js). Keine Beschreibung/Farbe, da für
// sie nichts dergleichen gepflegt ist. Listen und Werte mit Randleerzeichen
// (siehe isCleanKey in typ-index.js) bleiben außen vor - der gewählte Wert
// wird in eine neue Notiz geschrieben und soll dort kein Aufräumfall sein.
function unregisteredItems(app, plugin) {
  const registered = new Set(plugin.settings.types);
  const { counts } = plugin.typIndex.typeCounts();
  const sortOrder = plugin.settings.typSortOrder ?? DEFAULT_SORT_ORDER;
  return [...counts.keys()]
    .filter((type) => !registered.has(type) && plugin.typIndex.isCleanKey(type))
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
function pickType(app, plugin, options = {}) {
  return new Promise((resolve) => {
    const items = typeItems(app, plugin, options);
    if (!items) {
      resolve(null);
      return;
    }
    new TypPickerModal(app, plugin, items, resolve).open();
  });
}

// Gemeinsame TYP-Liste für pickType/pickTypeAndSubtype - null samt Notice,
// falls es (auch mit den gewählten Optionen) keine TYPen gibt.
function typeItems(app, plugin, { includeManualOff = false, includeUnregistered = false } = {}) {
  const items = plugin.getTypes({ includeManualOff }).map((item) => ({ ...item, unregistered: false }));
  if (includeUnregistered) items.push(...unregisteredItems(app, plugin));
  if (items.length > 0) return items;
  new Notice("Keine TYPen vorhanden.");
  return null;
}

// Für _obsidian/templater-scripts/TYP.js: TYP und Subtyp in einem Zug. Je
// nach Einstellung separateSubtypePicker entweder ein einziger Picker mit den
// Subtypen eingerückt unter ihrem TYP (Standard), oder wie früher erst der
// TYP-Picker und danach, falls der TYP Subtypen hat, der Subtyp-Picker (ESC
// dort führt zurück zur TYP-Auswahl). Optionen wie bei pickType. Löst auf mit
// { type, subtype } (subtype null für "ohne Subtyp"), oder mit null bei
// Abbruch.
async function pickTypeAndSubtype(app, plugin, options = {}) {
  if (plugin.settings.separateSubtypePicker) {
    while (true) {
      const type = await pickType(app, plugin, options);
      if (!type) return null;
      const subtype = await pickSubtype(app, plugin, type);
      if (subtype !== null) return { type, subtype: subtype || null };
    }
  }

  const items = typeItems(app, plugin, options);
  if (!items) return null;
  const groups = items.map((item) => ({
    item,
    subtypes: plugin.getSubtypes(item.type).map(({ subtype, count }) => ({ type: item.type, subtype, count })),
  }));
  return new Promise((resolve) => new TypSubtypPickerModal(app, plugin, groups, resolve).open());
}

module.exports = { pickType, pickSubtype, pickTypeAndSubtype };
