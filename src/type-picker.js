const { FuzzySuggestModal, Notice, prepareFuzzySearch } = require("obsidian");
const { compareTypes, DEFAULT_SORT_ORDER } = require("./typ-view");
const { nameColor, paintColorDot } = require("./type-colors");

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

  // Fuzzy-Suche greift auch auf die Beschreibung, nicht nur auf den TYP-Namen -
  // und auf die Subtypen, wo sie in der Zeile stehen (showSubtypes, siehe
  // typeItems): sie sind dann sichtbar, also erwartet man auch, sie tippen zu
  // können, und im separaten Ablauf ist der TYP darüber der Weg zu ihnen.
  getItemText(item) {
    return [item.type, item.subtypes?.join(" "), item.description].filter(Boolean).join(" ");
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

    if (item.subtypes?.length) this.renderSubtypePreview(el, item);

    if (item.description) {
      el.createSpan({ cls: "fred-typ-picker-desc", text: item.description });
    }

    el.createSpan({ cls: "fred-typ-picker-count", text: String(item.count) });
  }

  // Name in der Farbe von colorType (bzw. des Subtyps, siehe nameColor in
  // type-colors.js - dieselbe Grundlage nutzt die Subtyp-Vorschau der TYP-Liste)
  // - je nach Einstellung "TYP View einfärben" als eingefärbter Text oder mit
  // vorangestelltem Farbpunkt.
  renderColoredName(el, text, colorType, subtype = null) {
    const { color, isDefault } = nameColor(this.plugin.settings, colorType, subtype);
    if (this.plugin.settings.colorViews.typList) {
      el.createSpan({ cls: "fred-typ-picker-name", text }).style.color = color;
    } else {
      paintColorDot(el.createSpan({ cls: "fred-typ-picker-dot" }), color, isDefault);
      el.createSpan({ cls: "fred-typ-picker-name", text });
    }
  }

  // "TYP (Subtyp 1, Subtyp 2)" - welche Subtypen unter dem TYP liegen, schon
  // in der TYP-Auswahl des separaten Ablaufs (siehe pickTypeAndSubtype), wo
  // der Subtyp-Picker erst danach kommt. Jeder Subtyp in seiner eigenen Farbe,
  // Klammern und Kommas muted; ohne "TYP View einfärben" bleibt die Vorschau
  // wie der Name selbst ungefärbt.
  renderSubtypePreview(el, item) {
    const colorize = this.plugin.settings.colorViews.typList;
    const wrap = el.createSpan({ cls: "fred-typ-picker-subtypes" });
    wrap.appendText("(");
    item.subtypes.forEach((subtype, index) => {
      if (index > 0) wrap.appendText(", ");
      const span = wrap.createSpan({ text: subtype });
      if (colorize) span.style.color = nameColor(this.plugin.settings, item.type, subtype).color;
    });
    wrap.appendText(")");
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
    // Was bei der Auswahl im Suchfeld stand - der Subtyp-Picker sortiert danach
    // vor (siehe pickTypeEntry/sortByQuery).
    this.query = this.inputEl.value.trim();
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
// Wie TypPickerModal, zusätzlich mit dem Eintrag "TYP (ohne Subtyp)" an
// erster Stelle (item.none). ESC löst mit null auf - TYP.js kehrt dann zur
// TYP-Auswahl zurück. Subtypen haben keine Beschreibung, der Name steht in
// der Farbe des Subtyps (bzw. des TYPs) mit Notiz-Anzahl. query ist die
// Suchanfrage aus dem TYP-Picker, nach der die Liste vorsortiert steht.
class SubtypPickerModal extends TypPickerModal {
  constructor(app, plugin, type, items, resolve, query = "") {
    super(app, plugin, items, resolve);
    this.type = type;
    this.setPlaceholder(`Subtyp für ${type} – ESC für zurück`);
    this.items = sortByQuery(items, query, (item) => this.getItemText(item));
  }

  // Die "ohne Subtyp"-Zeile ist auch über den TYP-Namen zu finden, den sie
  // zeigt - ein im TYP-Picker getipptes "ORGA" holt sie damit von allein
  // wieder an den Anfang, obwohl dort der TYP und nicht ein Subtyp gemeint war.
  getItemText(item) {
    return item.none ? `${this.type} ${item.type}` : super.getItemText(item);
  }

  renderSuggestion(match, el) {
    const item = match.item;
    el.addClass("fred-typ-picker-suggestion");
    if (item.none) {
      // "ORGA (ohne Subtyp)": der TYP selbst in seiner Farbe (bzw. mit
      // Farbpunkt), der Zusatz in normaler Textfarbe statt muted - die Zeile
      // ist die Wahl "dieser TYP, ohne Subtyp" und keine ausgegraute
      // Nicht-Wahl, und der helle Zusatz hebt sie zugleich von den
      // Subtyp-Zeilen darunter ab, die nur aus ihrem Namen bestehen.
      this.renderColoredName(el, this.type, this.type);
      el.createSpan({ cls: "fred-typ-picker-none", text: `(${item.type})` });
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

// Ausgangs-Reihenfolge einer Picker-Liste nach einer schon getippten Suchanfrage
// (der aus dem TYP-Picker, siehe pickTypeEntry): worauf sie passt, steht oben,
// nach Treffergüte, alles andere dahinter in unveränderter Reihenfolge. "Passt
// auf nichts" lässt die Liste, wie sie war - getippt war dann z. B. eine
// Beschreibung, über die hier nichts zu schließen ist. Danach greift wieder
// Obsidians eigene Suche, sobald im Picker selbst getippt wird.
function sortByQuery(items, query, itemText) {
  const search = query?.trim() ? prepareFuzzySearch(query.trim()) : null;
  if (!search) return items;
  const scored = items.map((item, index) => ({ item, index, score: search(itemText(item))?.score ?? null }));
  if (scored.every((entry) => entry.score === null)) return items;
  scored.sort((a, b) => {
    if (a.score === null || b.score === null) return a.score === b.score ? a.index - b.index : a.score === null ? 1 : -1;
    return b.score - a.score || a.index - b.index;
  });
  return scored.map((entry) => entry.item);
}

// Für _obsidian/templater-scripts/TYP.js: öffnet den Subtyp-Picker, sobald
// der TYP mindestens einen registrierten Subtyp hat (in der Reihenfolge der
// Blöcke in der TYP-Detailansicht). query ist die Suchanfrage aus dem
// TYP-Picker, nach der die Liste vorsortiert wird (siehe sortByQuery): wer
// dort "Lehrveranstaltung" tippte und so zu ORGA kam, meinte diesen Subtyp und
// findet ihn hier oben - Enter genügt. Löst auf mit
//  - dem gewählten Subtyp,
//  - "" für "ohne Subtyp" (ohne Anfrage der erste Eintrag der Liste) - bzw.
//    sofort, ohne Picker, wenn der TYP gar keine Subtypen hat,
//  - null bei ESC (TYP.js kehrt dann zur TYP-Auswahl zurück).
function pickSubtype(app, plugin, type, query = "") {
  return new Promise((resolve) => {
    const items = plugin.getSubtypes(type).map(({ subtype, count }) => ({ type: subtype, description: "", count }));
    if (items.length === 0) {
      resolve("");
      return;
    }
    // "ohne Subtyp" an erster Stelle: die Auswahl ist ohne Tippen mit Enter
    // erledigt, und der Fall ist häufiger als jeder einzelne Subtyp.
    const noneCount = plugin.typIndex.subtypeBucket(type).noSubtype;
    items.unshift({ type: "ohne Subtyp", description: "", count: noneCount, none: true });
    new SubtypPickerModal(app, plugin, type, items, resolve, query).open();
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
// plugin.getTypes(): TYPen mit abgeschaltetem "Manuell erstellbar" sind
// standardmäßig ausgeklammert. includeUnregistered ergänzt zusätzlich TYPen,
// die in Notizen vorkommen, aber nicht in der TYP-Liste registriert sind -
// muted dargestellt, da für sie keine Farbe/Beschreibung existiert. Löst mit
// dem gewählten TYP auf, oder mit null bei Abbruch bzw. falls es (auch mit
// den gewählten Optionen) keine anzuzeigenden TYPen gibt. showSubtypes stellt
// die Subtypen des TYPs hinter dessen Namen (siehe renderSubtypePreview) -
// gedacht für die TYP-Auswahl des separaten Ablaufs, wo der Subtyp-Picker
// erst danach kommt.
function pickType(app, plugin, options = {}) {
  return pickTypeEntry(app, plugin, options).then((entry) => entry?.type ?? null);
}

// Wie pickType, löst aber mit { type, query } auf - query ist, was bei der
// Auswahl im Suchfeld stand. Nur für pickTypeAndSubtype: dort trägt die
// Anfrage in den Subtyp-Picker weiter (siehe sortByQuery), denn wer
// "Lehrveranstaltung" tippt, landet über die Subtyp-Vorschau bei ORGA und
// meint damit den Subtyp, nicht bloß den TYP.
function pickTypeEntry(app, plugin, options = {}) {
  return new Promise((resolve) => {
    const items = typeItems(app, plugin, options);
    if (!items) {
      resolve(null);
      return;
    }
    const modal = new TypPickerModal(app, plugin, items, (type) => resolve(type === null ? null : { type, query: modal.query }));
    modal.open();
  });
}

// Gemeinsame TYP-Liste für pickType/pickTypeAndSubtype - null samt Notice,
// falls es (auch mit den gewählten Optionen) keine TYPen gibt.
function typeItems(app, plugin, { includeManualOff = false, includeUnregistered = false, showSubtypes = false } = {}) {
  const items = plugin.getTypes({ includeManualOff }).map((item) => ({ ...item, unregistered: false }));
  if (includeUnregistered) items.push(...unregisteredItems(app, plugin));
  // Nur registrierte TYPen haben gepflegte Subtypen - für die übrigen bleibt
  // die Liste leer und die Zeile damit unverändert.
  if (showSubtypes) {
    for (const item of items) item.subtypes = plugin.getSubtypes(item.type).map(({ subtype }) => subtype);
  }
  if (items.length > 0) return items;
  new Notice("Keine TYPen vorhanden.");
  return null;
}

// Für _obsidian/templater-scripts/TYP.js: TYP und Subtyp in einem Zug. Je
// nach Einstellung separateSubtypePicker entweder ein einziger Picker mit den
// Subtypen eingerückt unter ihrem TYP (Standard), oder wie früher erst der
// TYP-Picker - dort mit den Subtypen des TYPs hinter dessen Namen, damit man
// sie schon vor der Wahl sieht - und danach, falls der TYP Subtypen hat, der
// Subtyp-Picker, vorsortiert nach der Suchanfrage von dort (ESC führt zurück
// zur TYP-Auswahl). Optionen wie bei pickType. Löst auf mit
// { type, subtype } (subtype null für "ohne Subtyp"), oder mit null bei
// Abbruch.
async function pickTypeAndSubtype(app, plugin, options = {}) {
  if (plugin.settings.separateSubtypePicker) {
    while (true) {
      const entry = await pickTypeEntry(app, plugin, { ...options, showSubtypes: true });
      if (!entry) return null;
      const subtype = await pickSubtype(app, plugin, entry.type, entry.query);
      if (subtype !== null) return { type: entry.type, subtype: subtype || null };
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
